#!/usr/bin/env python3
"""Repack the unaltered Shiu et al. v630 model connectivity for the browser.

Run: uv run --with numpy --with pandas --with pyarrow tools/prepare_data.py
Use --source-dir PATH to reuse an existing checkout of the pinned source.
No simulation weights, neuron identities, or edges are fitted or pruned.
"""
import argparse
import ast
import base64
import gzip
import hashlib
import json
import pickle
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

COMMIT = "91bdd1e7dcf193f3e7ca5a8933497fcef63b7960"
BASE = f"https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/{COMMIT}/"
HASHES = {
    "2023_03_23_completeness_630_final.csv": "e6b71e17671a9bdb05f55e4bc6774640a1418cb7a05125e0fc994ad40f9bfdfb",
    "2023_03_23_connectivity_630_final.parquet": "94db8c650533bc36ffa3223f2e62325d5648b8d6bd31c3a4e1c804628c7557b3",
    "figures.ipynb": "33cd73c0b4b4a291c51b7bab639c4fa28978e49e111ff0d6adbca5687addb84c",
    "sez_neurons.pickle": "2bc5a2a8289924f2de39a8e68bdc07025cb6d6c6c6ddc83a973c0cace7cec2ce",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def build(source, output):
    for name, expected in HASHES.items():
        path = source / name
        if not path.exists():
            urllib.request.urlretrieve(BASE + name, path)
        if sha(path.read_bytes()) != expected:
            raise ValueError(f"Source hash mismatch: {name}")

    ids = pd.read_csv(source / "2023_03_23_completeness_630_final.csv", index_col=0).index.to_numpy(dtype="<u8")
    edges = pd.read_parquet(source / "2023_03_23_connectivity_630_final.parquet")
    # Stable order only changes the storage layout, preserving every source row.
    edges = edges.sort_values(["Presynaptic_Index", "Postsynaptic_Index"], kind="stable")
    pre = edges["Presynaptic_Index"].to_numpy(dtype="<u4")
    targets = edges["Postsynaptic_Index"].to_numpy(dtype="<u4")
    signed = edges["Excitatory x Connectivity"].to_numpy()
    assert signed.min() >= -32768 and signed.max() <= 32767
    assert np.array_equal(ids[pre], edges["Presynaptic_ID"].to_numpy(dtype="<u8"))
    assert np.array_equal(ids[targets], edges["Postsynaptic_ID"].to_numpy(dtype="<u8"))
    assert np.array_equal(signed, edges["Connectivity"].to_numpy() * edges["Excitatory"].to_numpy())
    offsets = np.zeros(len(ids) + 1, dtype="<u4")
    offsets[1:] = np.cumsum(np.bincount(pre, minlength=len(ids)), dtype=np.uint32)
    weights = signed.astype("<i2")
    arrays = {"offsets": offsets, "targets": targets, "weights": weights, "ids": ids}
    byte_offsets, byte_lengths, chunks, cursor = {}, {}, [], 0
    for name, array in arrays.items():
        # Align the Uint64 root ID table for direct BigUint64Array construction.
        alignment = array.dtype.itemsize
        padding = (-cursor) % alignment
        if padding:
            chunks.append(bytes(padding))
            cursor += padding
        raw = array.tobytes()
        byte_offsets[name] = cursor
        byte_lengths[name] = len(raw)
        chunks.append(raw)
        cursor += len(raw)
    raw = b"".join(chunks)
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)

    # Read literal neuron selections from the authors' experiment notebook.
    literals = {}
    for cell in json.loads((source / "figures.ipynb").read_text())["cells"]:
        if cell["cell_type"] != "code":
            continue
        try:
            tree = ast.parse("".join(cell["source"]))
        except SyntaxError:
            continue
        for node in tree.body:
            if not isinstance(node, ast.Assign):
                continue
            try:
                value = ast.literal_eval(node.value)
            except (ValueError, TypeError):
                continue
            for target in node.targets:
                if isinstance(target, ast.Name):
                    literals[target.id] = value
    # Only unpickle the specific author artifact after the SHA256 check above.
    sez = pickle.loads((source / "sez_neurons.pickle").read_bytes())
    selections = {
        "sweet": literals["neu_sugar"],
        "bitter": literals["neu_bitter"],
        "water": literals["neu_water"],
        "mn9": literals["ids_mn9"],
        **{name: sez[name] for name in ["roundup", "bract", "clavicle", "fudog", "phantom", "rattle", "usnea", "G2N_1", "FMIn", "Fdg"]},
    }
    index = {int(root_id): i for i, root_id in enumerate(ids)}
    groups = {name: [index[int(root_id)] for root_id in selected] for name, selected in selections.items()}
    labels = {"sweet": "Sugar GRN", "bitter": "Bitter GRN", "water": "Water GRN", "mn9": "MN9"}
    neurons = {}
    for group, selected in selections.items():
        for ordinal, root_id in enumerate(selected, 1):
            i = index[int(root_id)]
            neurons[str(i)] = {"id": str(root_id), "group": group, "label": f"{labels.get(group, group)} {ordinal}"}
    meta = {
        "format": "flywire-csr-v1", "endianness": "little", "materialization": 630,
        "neuronCount": len(ids), "edgeCount": len(targets),
        "anatomicalSynapseCount": int(edges["Connectivity"].sum()),
        "weightUnit": "signed anatomical synapse count; multiply by 0.275 mV",
        "byteOffsets": byte_offsets, "byteLengths": byte_lengths,
        "uncompressedBytes": len(raw), "compressedBytes": len(compressed),
        "sha256": sha(raw), "gzipSha256": sha(compressed),
        "groups": groups, "neurons": neurons,
        "source": {
            "repository": "https://github.com/philshiu/Drosophila_brain_model", "commit": COMMIT,
            "archive": "https://doi.org/10.17617/3.CZODIW", "archiveLicense": "MIT",
            "archiveLicenseMetadata": "https://edmond.mpdl.mpg.de/api/datasets/:persistentId/?persistentId=doi:10.17617/3.CZODIW",
            "underlyingDataGuidelines": "https://flywire.ai/guidelines",
            "underlyingDataLicense": "CC-BY-NC-4.0",
            "licenseNote": "The exact author-distributed model input files have an MIT archive notice. FlyWire general public-data guidelines specify CC BY-NC 4.0. Both notices are retained; this package treats underlying connectome reuse as noncommercial and does not interpret the archive notice as overriding upstream terms.",
            "files": {name: {"url": BASE + name, "sha256": value} for name, value in HASHES.items()},
        },
        "transformation": "Every original v630 neuron and edge retained. Rows sorted by presynaptic then postsynaptic index. Signed anatomical counts stored losslessly as Int16. Original root IDs stored losslessly as Uint64. No aggregation, pruning, fitting, or injected connections.",
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "metadata.json").write_text(json.dumps(meta, indent=2) + "\n")
    (output / "connectome.js").write_text("/* Shiu et al. v630 model data; source and underlying data terms in data/LICENSE. */\nglobalThis.FlyData=" + json.dumps({"meta": meta, "base64": base64.b64encode(compressed).decode()}, separators=(",", ":")) + ";\n")
    print(json.dumps({key: meta[key] for key in ["neuronCount", "edgeCount", "anatomicalSynapseCount", "uncompressedBytes", "compressedBytes", "sha256"]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data")
    args = parser.parse_args()
    if args.source_dir:
        build(args.source_dir, args.output)
    else:
        with tempfile.TemporaryDirectory(prefix="flywire-v630-") as directory:
            build(Path(directory), args.output)
