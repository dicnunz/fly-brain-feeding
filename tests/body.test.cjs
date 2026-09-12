'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const FlyBrain = require('../model.js');
const FlyBody = require('../body.js');

let cachedData;
function sourceData() {
  if (cachedData) return cachedData;
  const scope = {};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../data/connectome.js'),'utf8'),scope);
  const {meta,base64} = scope.FlyData;
  const packed = zlib.gunzipSync(Buffer.from(base64,'base64'));
  const b = packed.buffer, o = packed.byteOffset;
  cachedData = {offsets:new Uint32Array(b,o+meta.byteOffsets.offsets,meta.neuronCount+1),
    targets:new Uint32Array(b,o+meta.byteOffsets.targets,meta.edgeCount),
    weights:new Int16Array(b,o+meta.byteOffsets.weights,meta.edgeCount),groups:meta.groups};
  return cachedData;
}
function experiment(seed=123, options={}) {
  const data=sourceData(), brain=new FlyBrain(data,seed), body=new FlyBody();
  if (options.contact !== false) body.drop={x:105,y:23,radius:27};
  if (options.drop) body.drop={...body.drop,...options.drop};
  body.bitter=Boolean(options.bitter);
  body.blockTaste=Boolean(options.taste);
  brain.setClamped('mn9',Boolean(options.motor));
  const mn9=new Set(data.groups.mn9);
  return {brain,body,run(milliseconds) {
    let sum=0,peak=0,contactSteps=0,transitions=0,motorSpikes=0;
    let previous=body.contact();
    const trace=[];
    for(let k=0;k<Math.round(milliseconds*10);k++) {
      // This is the actual worker's closed loop, with no body/controller stub.
      brain.setRates(...body.sensoryRates());
      let motor=0;
      for(const i of brain.step()) if(mn9.has(i))motor++;
      body.step(.1,motor);
      motorSpikes+=motor;
      sum+=body.extension;
      peak=Math.max(peak,body.extension);
      const contact=body.contact();
      contactSteps+=Number(contact);
      if(contact!==previous)transitions++;
      previous=contact;
      assert.ok(Number.isFinite(body.extension) && body.extension>=0 && body.extension<=1);
      assert.ok(Number.isFinite(body.velocity) && Number.isFinite(body.activation));
      if(k%1000===0)trace.push([body.extension,body.velocity,body.activation,brain.totalSpikes]);
    }
    const steps=Math.round(milliseconds*10);
    return {meanExtension:sum/steps,peakExtension:peak,contactFraction:contactSteps/steps,
      transitions,motorSpikes,trace,neural:brain.snapshot()};
  }};
}

test('only physical mouth contact supplies gustatory input', () => {
  const body=new FlyBody();
  assert.equal(body.contact(),false);
  assert.deepEqual(body.sensoryRates(),[0,0]);
  body.bitter=true;
  assert.deepEqual(body.sensoryRates(),[0,0]);
  const tip=body.joints().tip;
  body.drop={x:tip.x,y:tip.y,radius:27};
  assert.deepEqual(body.sensoryRates(),[200,200]);
  body.blockTaste=true;
  assert.equal(body.contact(),true);
  assert.deepEqual(body.sensoryRates(),[0,0]);
  const quiet=experiment(123,{contact:false}).run(500);
  assert.equal(quiet.neural.totalSpikes,0);
  assert.equal(quiet.peakExtension,0);
});

test('matched-seed bitter coactivation suppresses neural motor spikes and extension', () => {
  const sweet=experiment(123).run(3000);
  const bitter=experiment(123,{bitter:true}).run(3000);
  assert.equal(sweet.contactFraction,1);
  assert.equal(bitter.contactFraction,1);
  assert.ok(sweet.neural.groups.sweet.spikes>10000);
  assert.ok(bitter.neural.groups.bitter.spikes>10000);
  assert.ok(bitter.motorSpikes<sweet.motorSpikes*.3);
  assert.ok(bitter.meanExtension<sweet.meanExtension*.3);
  console.log(JSON.stringify({matchedSeed:123,sweet:{meanExtension:sweet.meanExtension,motorSpikes:sweet.motorSpikes},
    sweetAndBitter:{meanExtension:bitter.meanExtension,motorSpikes:bitter.motorSpikes}}));
});

test('MN9 clamp removes motor spikes and movement while taste remains active', () => {
  const control=experiment(123).run(2000);
  const blocked=experiment(123,{motor:true}).run(2000);
  assert.ok(control.motorSpikes>0);
  assert.equal(blocked.motorSpikes,0);
  assert.equal(blocked.peakExtension,0);
  assert.ok(blocked.neural.groups.sweet.spikes>0);
  assert.equal(blocked.neural.groups.sweet.spikes,control.neural.groups.sweet.spikes);
  const live=experiment(123);
  live.run(1000);
  assert.ok(live.body.extension>.3);
  const activationBeforeClamp=live.body.activation;
  live.brain.setClamped('mn9',true);
  assert.equal(live.body.activation,activationBeforeClamp);
  live.run(.1);
  assert.ok(live.body.activation>0 && live.body.activation<activationBeforeClamp);
  const withdrawal=live.run(2000);
  assert.equal(withdrawal.motorSpikes,0);
  assert.ok(live.body.extension<1e-5);
  assert.ok(withdrawal.neural.groups.sweet.spikes>0);
});

test('blocking taste removes environmental drive and allows the active body to retract', () => {
  const initial=experiment(123,{taste:true}).run(1000);
  assert.equal(initial.contactFraction,1);
  assert.equal(initial.neural.totalSpikes,0);
  assert.equal(initial.peakExtension,0);
  const live=experiment(123);
  live.run(1000);
  live.body.blockTaste=true;
  const after=live.run(3000);
  assert.deepEqual(live.body.sensoryRates(),[0,0]);
  assert.ok(live.body.extension<1e-5);
  // Transient network activity after removing input is permitted. The final
  // window verifies settling without assuming instantaneous neural shutdown.
  const settled=live.run(500);
  assert.equal(settled.motorSpikes,0);
  assert.equal(settled.neural.groups.sweet.spikes,0);
  assert.ok(after.contactFraction===1);
});

test('motor-driven geometry breaks and restores contact with a stationary boundary drop', () => {
  const location={x:89,y:-24,radius:27};
  const live=experiment(123,{drop:location});
  assert.equal(live.body.contact(),true);
  const responsive=live.run(3000);
  assert.deepEqual(live.body.drop,location);
  assert.ok(responsive.transitions>=4);
  assert.ok(responsive.contactFraction>.05 && responsive.contactFraction<.8);
  assert.ok(responsive.motorSpikes>0);
  const clamped=experiment(123,{drop:location,motor:true}).run(3000);
  assert.equal(clamped.transitions,0);
  assert.equal(clamped.contactFraction,1);
  assert.ok(clamped.neural.groups.sweet.spikes>responsive.neural.groups.sweet.spikes*2);
  console.log(JSON.stringify({stationaryBoundaryDrop:location,contactTransitions:responsive.transitions,
    contactFraction:responsive.contactFraction,meanExtension:responsive.meanExtension}));
});

test('the full sensorimotor loop replays identical seeds and varies with a different seed', () => {
  const a=experiment(731).run(1500);
  const b=experiment(731).run(1500);
  const c=experiment(732).run(1500);
  assert.deepEqual(a.trace,b.trace);
  assert.equal(a.meanExtension,b.meanExtension);
  assert.equal(a.motorSpikes,b.motorSpikes);
  assert.notDeepEqual(a.trace,c.trace);
});

test('body class is standalone in a Blob worker and remains stable for 20 simulated seconds', () => {
  const scope={};
  vm.runInNewContext('this.FlyBody='+FlyBody.toString(),scope);
  const body=new scope.FlyBody();
  assert.equal(body.extension,0);
  const live=experiment(902,{drop:{x:89,y:-24}});
  const start=performance.now();
  let transitions=0,peak=0;
  for(let block=0;block<20;block++) {
    live.body.bitter=block%2===1;
    const state=live.run(1000);
    transitions+=state.transitions;
    peak=Math.max(peak,state.peakExtension);
  }
  assert.equal(live.brain.tick,200000);
  assert.ok(transitions>0 && peak>0);
  console.log(JSON.stringify({bodyStabilitySimulatedMs:20000,wallMs:performance.now()-start,
    contactTransitions:transitions,peakExtension:peak,totalSpikes:live.brain.totalSpikes}));
});
