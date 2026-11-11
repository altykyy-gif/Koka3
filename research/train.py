"""Evaluate a research forecast on manual glucose inputs from ShanghaiT2DM v5."""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

import numpy as np
import pandas as pd
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ARCHIVE_SHA256 = "59b5f5c4053a32bb6b7827844a0191597dc82228fe88ce332a189fdfc659c4cb"
DATA_DOI = "https://doi.org/10.6084/m9.figshare.21600933.v5"
REFERENCE = "https://pmc.ncbi.nlm.nih.gov/articles/PMC9849330/"
WINDOW_MINUTES = 60
MINIMUM_EVENTS = 20
SEED = 51


def read_examples(archive):
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("Use the unmodified Shanghai diabetes datasets archive, version 5.")

    samples = []
    stats = {"sessions": 0, "manual_readings": 0, "current_in_range": 0,
             "recent_previous_reading": 0, "complete_sensor_window": 0}
    with ZipFile(archive) as dataset:
        sessions = sorted(name for name in dataset.namelist()
                          if name.startswith("Shanghai_T2DM/") and name.endswith((".xls", ".xlsx")))
        for name in sessions:
            stats["sessions"] += 1
            participant = PurePosixPath(name).stem.split("_", 1)[0]
            table = pd.read_excel(io.BytesIO(dataset.read(name)), usecols=[0, 1, 2],
                                  engine="xlrd" if name.endswith(".xls") else "openpyxl")
            table.columns = ["time", "sensor", "manual"]
            table["time"] = pd.to_datetime(table["time"], format="mixed", errors="coerce")
            for column in ("sensor", "manual"):
                table[column] = pd.to_numeric(table[column], errors="coerce")
            table = table.dropna(subset=["time"]).sort_values("time").reset_index(drop=True)

            previous = None
            for i, row in enumerate(table.itertuples(index=False)):
                if not np.isfinite(row.manual):
                    continue
                stats["manual_readings"] += 1
                earlier = previous
                previous = row if 20 <= row.manual <= 700 else None
                if not 70 <= row.manual <= 180:
                    continue
                stats["current_in_range"] += 1
                if earlier is None:
                    continue
                gap = (row.time - earlier.time).total_seconds() / 60
                if not 15 <= gap <= 1440:
                    continue
                stats["recent_previous_reading"] += 1
                future = table.iloc[i+1:i+5]
                elapsed = (future["time"] - row.time).dt.total_seconds().to_numpy() / 60
                if len(future) != 4 or not np.isfinite(future["sensor"]).all():
                    continue
                if not np.all(np.abs(elapsed - np.arange(15, WINDOW_MINUTES + 1, 15)) <= 1):
                    continue
                stats["complete_sensor_window"] += 1
                samples.append({
                    "participant": participant,
                    "current": row.manual,
                    "change": row.manual - earlier.manual,
                    "log_gap": np.log1p(gap),
                    "high": bool((future["sensor"] > 180).any()),
                    "low": bool((future["sensor"] < 70).any()),
                })

    return pd.DataFrame(samples), stats


def score(y, prob):
    return {
        "brier": round(float(brier_score_loss(y, prob)), 6),
        "average_precision": round(float(average_precision_score(y, prob)), 6),
        "auc": round(float(roc_auc_score(y, prob)), 6),
    }


def interval_by_participant(people, y, prob, baseline):
    people = np.asarray(people)
    y = np.asarray(y)
    clusters = [np.flatnonzero(people == person) for person in np.unique(people)]
    rng = np.random.default_rng(SEED)
    areas, changes = [], []
    for _ in range(1000):
        positions = rng.integers(len(clusters), size=len(clusters))
        rows = np.concatenate([clusters[i] for i in positions])
        truth = y[rows]
        if np.unique(truth).size < 2:
            continue
        area = roc_auc_score(truth, prob[rows])
        areas.append(area)
        changes.append(area - roc_auc_score(truth, baseline[rows]))
    return {
        "replicates": len(areas),
        "auc_95": np.round(np.quantile(areas,[.025,.975]),6).tolist(),
        "auc_gain_vs_latest_95": np.round(np.quantile(changes,[.025,.975]),6).tolist(),
    }


def evaluate(samples, fit, holdout, outcome):
    tr = samples.iloc[fit]
    te = samples.iloc[holdout]
    y = tr[outcome]
    y_test = te[outcome]
    train_events = int(y.sum())
    test_events = int(y_test.sum())
    result = {
        "train_events": train_events,
        "test_events": test_events,
        "train_participants_with_event": int(tr.loc[y,"participant"].nunique()),
        "test_participants_with_event": int(te.loc[y_test,"participant"].nunique()),
    }
    if min(train_events, test_events, len(y)-train_events, len(y_test)-test_events) < MINIMUM_EVENTS:
        return result

    base = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, random_state=SEED))
    base.fit(tr[["current"]], y)
    feature_names = ["current", "change", "log_gap"]
    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, random_state=SEED))
    model.fit(tr[feature_names], y)
    prob = model.predict_proba(te[feature_names])[:, 1]
    result["training_rate_baseline"] = score(y_test, np.full(len(y_test), float(y.mean())))
    baseline = base.predict_proba(te[["current"]])[:, 1]
    result["latest_reading_baseline"] = score(y_test, baseline)
    result["model"] = score(y_test, prob)
    result["participant_bootstrap"] = interval_by_participant(te["participant"], y_test, prob, baseline)

    scaler = model[0]
    classifier = model[1]
    result["parameters"] = {
        "features": feature_names,
        "means": scaler.mean_.tolist(),
        "scales": scaler.scale_.tolist(),
        "weights": classifier.coef_[0].tolist(),
        "intercept": float(classifier.intercept_[0]),
    }
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    samples, extraction = read_examples(args.archive)
    fit, holdout = next(GroupShuffleSplit(test_size=0.25, random_state=SEED)
                        .split(samples, groups=samples["participant"]))
    train_people = set(samples.iloc[fit]["participant"])
    test_people = set(samples.iloc[holdout]["participant"])
    if train_people & test_people:
        raise RuntimeError("A participant appeared in both sets.")

    report = {
        "schema": 1,
        "dataset": DATA_DOI,
        "reference": REFERENCE,
        "archive_sha256": ARCHIVE_SHA256,
        "window_minutes": WINDOW_MINUTES,
        "seed": SEED,
        "versions": {"pandas": pd.__version__, "numpy": np.__version__, "sklearn": sklearn.__version__},
        "extraction": extraction,
        "train": {"examples": len(fit), "participants": len(train_people)},
        "test": {"examples": len(holdout), "participants": len(test_people)},
        "outcomes": {label:evaluate(samples, fit, holdout, label) for label in ("high","low")},
    }
    text = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    print(text, end="")


if __name__ == "__main__":
    main()
