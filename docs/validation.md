# Validation

Recorded 12 September 2026 on an Apple M3 MacBook Air with 16 GB RAM. These checks concern this computational implementation. They do not establish biological accuracy beyond the cited experimental relationships.

## Data and solver

`node --test tests/*.test.cjs` runs 15 dependency-free tests against the bundled, complete graph.

- Every packed neuron ID, signed connection count, target and CSR offset was compared with the pinned source files. No edges were removed. The original source file hashes also match the authors’ Edmond archive.
- The unpacked 89,651,872-byte payload has SHA-256 `d369e346db7ab655be4edbb3abeb8cf9473f622a6f83b6e4dc1bab922990c9c3`. Tests check it, and browsers with Web Crypto verify it during startup.
- A six-cell recurrent excitatory/inhibitory fixture reproduces all 24 reference spike times from Brian2 2.10.1 using the published equations and scheduler. The independently generated reference differed by at most 4.34 × 10⁻¹³ mV in voltage. This is a numerical fixture, not a full-graph Brian2 equivalence proof.
- Dense versus sparse integration, exact subthreshold decay, 1.8 ms transmission delay, refractoriness, inhibitory effects, outgoing disconnection, explicit motor clamp, seeded replay and computed counters are checked separately.

## Closed sensorimotor loop

The full graph and the same body equations used by the worker run in the tests. Seed 123, three seconds, sustained mouth contact:

| Condition | MN9 spikes, both cells | Mean normalized extension |
| --- | ---: | ---: |
| Sugar | 466 | 0.850 |
| Sugar and bitter | 52 | 0.098 |

The near-identical sugar input realization is maintained in this comparison. Motor suppression is caused by bitter activity propagating through the graph. These are model outputs, not measured animal values.

Clamping MN9 removes its spikes and movement while preserving upstream sugar activity. Clamping after an ongoing extension leaves the muscle state intact; it decays normally with no new motor spikes. Blocking sensory input also permits retraction after ongoing activity decays. No-contact conditions have zero external sensory drive and no spontaneous movement.

A stationary droplet at the contact boundary changes contact 13 times in a three-second trial. Holding the motor neurons clamped eliminates those changes. Thus moving body geometry changes subsequent sensation without moving the environment or running a behavior script. That test establishes model feedback, not a biological feeding rhythm.

Repeated seeds reproduce the complete tested body/neural trace; differing seeds produce different realizations. Twenty simulated seconds of the boundary-contact loop remain finite and bounded, with 70 contact transitions and 159,172 network spikes. A separate 20-second whole-network stress test alternates maximum sugar and sugar-plus-bitter input, producing 346,021 spikes with finite state across all 127,400 neurons.

## Browser interaction and performance

The local browser experiment was exercised for more than four simulated minutes with sustained sugar, sugar-plus-bitter, sensory blockade, MN9 clamp, direct droplet dragging, pause/resume and the spike inspector. No console errors were observed. The final mechanical intervention was then reloaded and retested. The neural solver and graph were unchanged by that correction.

Visible checks confirmed sugar-induced extension; bitter-induced suppression; continuing taste/network activity with MN9 silenced; zero sensory drive after droplet withdrawal; and unchanged simulation time during pause. Layout was inspected at 1280 × 720 and 390 × 844. The narrow viewport had no horizontal overflow.

Measurements in the Chromium-based desktop browser, with the real graph and inspector active:

| Measurement | Observed result |
| --- | --- |
| Frame interval, p95 | 17.5–18.6 ms |
| Fly drawing, p95 | 0.20–0.80 ms desktop; up to 2.20 ms during narrow-screen interaction |
| Worker neural/body compute | Approximately 13–48% of simulated time under sustained active conditions |
| Main-thread task CPU | 11.46 s during a 93.66 s DevTools measurement interval, about 12.2% of one core |
| Main-context JS heap used | Approximately 69–77 MB in sampled snapshots |
| Main-context backing storage | Approximately 61 MB in sampled snapshots |
| Packed network and neural working arrays | Approximately 93.4 MiB, estimated separately from browser heap |

The browser remained responsive while running at approximately real time. These are measurements on a working laptop, with other task activity, rather than an isolated performance benchmark. Node’s separate 20-second neural stress test took approximately 1.8 seconds after implementation; it is not substituted for browser evidence.

There is no WebGPU/WebGL simulation or remote inference. Canvas drawing time is measured; GPU composition time and total browser-process memory were not independently measured. Main-context heap figures do not include the worker’s full memory. The packed graph is transferred to the worker once; subsequent messages carry small state summaries and observed spike events, never the entire network. Serialization overhead is included in browser CPU observations but was not isolated as a separate benchmark.

## Boundaries

Browser rendering and neural/physical causality are distinct checks. The drawing is an anatomical illustration, with fixed legs and wings and moving mouthparts. Its proportions, mechanics and contact geometry have not been fitted to tracked animal motion. No accessibility certification, full physiological fidelity, ingestion, locomotion or whole-animal reconstruction is claimed.
