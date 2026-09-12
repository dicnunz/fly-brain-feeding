/* Proboscis geometry and an explicitly phenomenological muscle/joint model.
 * MN9 -> rostrum protraction: McKellar et al., eLife 2020, 10.7554/eLife.54978.
 * The gains, joint constants and drawing units below are adaptation assumptions.
 */
class FlyBody {
  constructor() {
    this.extension = 0;
    this.velocity = 0;
    this.activation = 0;
    this.drop = { x: 177, y: 43, radius: 27 };
    this.bitter = false;
    this.blockTaste = false;
  }
  joints() {
    const e = this.extension;
    const base = { x: 91, y: -10 };
    const a = 2.8 - 1.25 * e;
    const b = .1 + 1.35 * e;
    const elbow = { x: base.x + 24 * Math.cos(a), y: base.y + 24 * Math.sin(a) };
    const tip = { x: elbow.x + 21 * Math.cos(b), y: elbow.y + 21 * Math.sin(b) };
    return { base, elbow, tip, angle: 1.25 * e * 180 / Math.PI };
  }
  contact() {
    const p = this.joints().tip;
    return Math.hypot(p.x - this.drop.x, p.y - this.drop.y) <= this.drop.radius + 5;
  }
  sensoryRates() {
    const taste = !this.blockTaste && this.contact();
    return [taste ? 200 : 0, taste && this.bitter ? 200 : 0];
  }
  step(dtMs, motorSpikes) {
    // Two MN9 cells contribute to the same bilateral protractor readout.
    // 0.1 per spike, 60 ms decay: 100 Hz per cell gives mean drive 1.2.
    const dt = dtMs / 1000;
    this.activation = this.activation * Math.exp(-dt / .06) + motorSpikes * .1;
    const force = Math.min(this.activation, 1.5);
    // Damped elastic joint; no target trajectory or behavior state machine.
    this.velocity += (100 * force - 100 * this.extension - 20 * this.velocity) * dt;
    this.extension += this.velocity * dt;
    if (this.extension < 0) { this.extension = 0; this.velocity = Math.max(0, this.velocity); }
    if (this.extension > 1) { this.extension = 1; this.velocity = Math.min(0, this.velocity); }
  }
  snapshot() {
    return { extension: this.extension, activation: this.activation, velocity: this.velocity,
      joints: this.joints(), contact: this.contact(), rates: this.sensoryRates(), drop: { ...this.drop } };
  }
}
if (typeof module !== 'undefined') module.exports = FlyBody;
