'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const FlyBrain = require('../model.js');

function network(n, edges, groups = {}) {
  const sorted = [...edges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const offsets = new Uint32Array(n + 1);
  for (const [source] of sorted) offsets[source + 1]++;
  for (let i = 1; i <= n; i++) offsets[i] += offsets[i - 1];
  return {offsets, targets: Uint32Array.from(sorted, e => e[1]), weights: Int16Array.from(sorted, e => e[2]), groups};
}
function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
// Intentionally dense reference: every neuron is integrated on every step,
// without FlyBrain's dormant-state optimization or its helper methods.
function dense(data) {
  const n = data.offsets.length - 1;
  const v = new Float64Array(n).fill(-52), g = new Float64Array(n);
  const last = new Float64Array(n).fill(-1e12);
  const ref = new Uint8Array(n).fill(22);
  for (const i of [...(data.groups.sweet || []), ...(data.groups.bitter || [])]) ref[i] = 0;
  const pending = new Map();
  let tick = 0;
  return {v, g, step(events) {
    const spikes = [];
    const free = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      free[i] = tick - last[i] >= ref[i];
      if (!free[i]) continue;
      const old = g[i];
      g[i] = old * Math.exp(-.1 / 5);
      v[i] = -52 + (v[i] + 52) * Math.exp(-.1 / 20) + old * (Math.exp(-.1 / 20) - Math.exp(-.1 / 5)) / 3;
      if (v[i] > -45) { spikes.push(i); last[i] = tick; free[i] = 0; }
    }
    for (const source of pending.get(tick) || []) {
      for (let e = data.offsets[source]; e < data.offsets[source + 1]; e++) {
        const target = data.targets[e];
        if (free[target]) g[target] += data.weights[e] * .275;
      }
    }
    pending.delete(tick);
    for (const [i, amount] of events) if (free[i]) v[i] += amount;
    pending.set(tick + 18, spikes);
    for (const i of spikes) { v[i] = -52; g[i] = 0; }
    tick++;
    return spikes;
  }};
}

test('exact membrane and synaptic decay, including analytically dormant cells', () => {
  const brain = new FlyBrain(network(2, []));
  brain.setState(0, -50, 3);
  brain.setState(1, -80, -18);
  assert.equal(brain.activeCount, 0);
  brain.advance(87.3);
  const a = Math.exp(-87.3 / 20), b = Math.exp(-87.3 / 5);
  near(brain.voltage(0), -52 + 2 * a + (a - b));
  near(brain.state(0).g, 3 * b);
  near(brain.voltage(1), -52 - 28 * a - 6 * (a - b));
  assert.equal(brain.totalSpikes, 0);
});

test('external input precedes next-step spike; synapses arrive exactly 1.8ms later', () => {
  const brain = new FlyBrain(network(2, [[0, 1, 100]], {sweet: [0]}));
  brain.inject('sweet');
  assert.deepEqual([...brain.step()], []);
  assert.deepEqual([...brain.step()], [0]); // t=0.1ms
  for (let tick = 2; tick < 19; tick++) { brain.step(); near(brain.state(1).g, 0); }
  brain.step(); // t=1.9ms: synapses slot, after integration
  near(brain.state(1).g, 27.5);
  near(brain.voltage(1), -52);
  brain.step();
  assert.ok(brain.voltage(1) > -52);
});

test('Brian2 recurrent E/I fixture reproduces every reference spike time', () => {
  // Reference produced with Brian2 2.10.1, method=linear, dt=0.1ms,
  // both variables unless refractory, source rfc=0, synapse delay=1.8ms.
  // Brian's end-of-step v/g differed from this port by <4.4e-13mV across
  // all 6000 neuron samples in a separately executed comparison.
  const data = network(6, [[0,2,160],[1,2,-100],[2,3,200],[3,2,60],[3,4,100],[4,5,-100],[5,4,100]], {sweet:[0],bitter:[1]});
  const brain = new FlyBrain(data), reference = dense(data), observed = [];
  const sweet = new Set([0,1,20,40,60,80,120,200,300,500]);
  const bitter = new Set([40,60,81,120,210,310]);
  for (let tick = 0; tick < 1000; tick++) {
    const events = [];
    if (sweet.has(tick)) { brain.inject(0); events.push([0,68.75]); }
    if (bitter.has(tick)) { brain.inject(1); events.push([1,68.75]); }
    const spikes = [...brain.step()];
    assert.deepEqual(spikes, reference.step(events));
    for (const i of spikes) observed.push([i, Number((tick * .1).toFixed(7))]);
    for (let i = 0; i < 6; i++) {
      near(brain.voltage(i), reference.v[i]);
      near(brain.state(i).g, reference.g[i]);
    }
  }
  assert.deepEqual(observed, [[0,.1],[0,2.1],[0,4.1],[1,4.1],[2,5.1],[0,6.1],[1,6.1],[0,8.1],[1,8.2],[3,11.2],[0,12.1],[1,12.1],[2,15.1],[0,20.1],[1,21.1],[3,21.2],[4,26.1],[0,30.1],[1,31.1],[2,32.9],[3,39],[0,50.1],[2,55],[3,61.1]]);
});

test('sparse lazy integration agrees with dense integration on a recurrent signed network', () => {
  const random = new FlyBrain(network(1, []), 582);
  const edges = [];
  for (let i = 0; i < 80; i++) for (let j = 0; j < 80; j++) {
    if (random.random() < .045) edges.push([i,j, (i % 3 ? 1 : -1) * (1 + Math.floor(random.random() * 170))]);
  }
  const data = network(80, edges, {sweet:[0,1],bitter:[2,3]});
  const brain = new FlyBrain(data), reference = dense(data);
  for (let tick = 0; tick < 5000; tick++) {
    const events = [];
    for (let i = 0; i < 4; i++) if (random.random() < .015) { brain.inject(i); events.push([i,68.75]); }
    assert.deepEqual([...brain.step()], reference.step(events), 'spike mismatch at ' + tick);
    // Sparse observations leave long intervals for actual lazy propagation.
    if (tick % 137 === 0 || tick === 4999) for (let i = 0; i < 80; i++) {
      near(brain.voltage(i), reference.v[i], 2e-9);
      near(brain.state(i).g, reference.g[i], 2e-9);
    }
  }
});

test('inhibition and outgoing silencing affect downstream activity, without silencing source', () => {
  function run(weight, silenced = false) {
    const brain = new FlyBrain(network(2, [[0,1,weight]], {sweet:[0],output:[1]}), 1);
    brain.setRates(200,0);
    brain.setSilenced('sweet',silenced);
    brain.advance(500);
    return brain;
  }
  const excitatory=run(300), inhibitory=run(-300), disconnected=run(300,true);
  assert.ok(excitatory.counts[1] > 0);
  assert.equal(inhibitory.counts[1],0);
  assert.ok(inhibitory.voltage(1) < -52);
  assert.equal(disconnected.counts[1],0);
  assert.equal(disconnected.counts[0],excitatory.counts[0]);
});

test('seed reproducibility, differing realizations, clamp, and readout counters', () => {
  const data = network(3, [[0,2,300],[1,2,-100]], {sweet:[0],bitter:[1],mn9:[2]});
  const a = new FlyBrain(data,7), b = new FlyBrain(data,7), c = new FlyBrain(data,8);
  for (const brain of [a,b,c]) { brain.setRates(150,50); brain.advance(1000); }
  assert.deepEqual(a.counts,b.counts);
  assert.deepEqual(a.u,b.u);
  assert.notDeepEqual(a.counts,c.counts);
  const snapshot = a.snapshot();
  assert.equal(snapshot.groups.mn9.spikes,a.counts[2]);
  near(snapshot.groups.mn9.rateHz,a.counts[2]);
  assert.equal(a.snapshot().windowSpikes,0);
  const before = a.counts[2];
  a.setClamped('mn9',true);
  a.advance(500);
  assert.equal(a.counts[2],before);
  assert.equal(a.voltage(2),-52);
  a.setClamped('mn9',false);
  a.advance(500);
  assert.ok(a.counts[2] > before);
});

test('class source is standalone for an offline Blob worker', () => {
  const scope = {};
  vm.runInNewContext('this.FlyBrain = ' + FlyBrain.toString(),scope);
  const b = new scope.FlyBrain(network(1,[],{sweet:[0]}));
  b.inject(0); b.advance(.2);
  assert.equal(b.totalSpikes,1);
});

test('full published graph: payload integrity, bitter suppression, perturbation, and sustained stability', {timeout:120000}, () => {
  const root = path.resolve(__dirname,'..');
  const scope = {};
  vm.runInNewContext(fs.readFileSync(path.join(root,'data/connectome.js'),'utf8'),scope);
  const {meta,base64} = scope.FlyData;
  const packed = zlib.gunzipSync(Buffer.from(base64,'base64'));
  assert.equal(crypto.createHash('sha256').update(packed).digest('hex'),meta.sha256);
  assert.equal(meta.neuronCount,127400);
  assert.equal(meta.edgeCount,14687178);
  const at = packed.byteOffset, bytes = packed.buffer;
  const data = {offsets:new Uint32Array(bytes,at+meta.byteOffsets.offsets,meta.neuronCount+1),
    targets:new Uint32Array(bytes,at+meta.byteOffsets.targets,meta.edgeCount),
    weights:new Int16Array(bytes,at+meta.byteOffsets.weights,meta.edgeCount),groups:meta.groups};
  const quiet = new FlyBrain(data,123);
  quiet.advance(1000);
  assert.equal(quiet.totalSpikes,0);
  const outcomes = {};
  for (const mode of ['sweet','bitter','roundup']) {
    const b = new FlyBrain(data,123);
    b.setRates(200,mode === 'bitter' ? 200 : 0);
    if (mode === 'roundup') b.setSilenced('roundup',true);
    b.advance(1000);
    outcomes[mode] = b.snapshot().groups.mn9.rateHz;
  }
  assert.ok(outcomes.sweet > 0);
  assert.ok(outcomes.bitter < outcomes.sweet * .5,JSON.stringify(outcomes));
  assert.ok(outcomes.roundup < outcomes.sweet * .5,JSON.stringify(outcomes));
  const sustained = new FlyBrain(data,731);
  let peakBatchMs = 0;
  const started = performance.now();
  for (let block=0;block<200;block++) {
    sustained.setRates(200,block % 2 ? 200 : 0);
    const start=performance.now(); sustained.advance(100);
    peakBatchMs=Math.max(peakBatchMs,performance.now()-start);
  }
  for (let i=0;i<meta.neuronCount;i++) {
    const {voltage,g}=sustained.state(i);
    assert.ok(Number.isFinite(voltage) && Number.isFinite(g));
  }
  console.log(JSON.stringify({fullGraphMn9RatesHz:outcomes,simulatedMs:20000,wallMs:performance.now()-started,peak100msBatchMs:peakBatchMs,totalSpikes:sustained.totalSpikes}));
});
