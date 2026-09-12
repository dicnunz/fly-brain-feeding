/* Original lateral drawing, informed by McKellar et al. 2020, Fig. 1.
 * Fixed legs/wings depict a held animal. Only the computed proboscis moves.
 */
class FlyDrawing {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.resize(); }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.width = r.width; this.height = r.height;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * this.dpr); this.canvas.height = Math.round(r.height * this.dpr);
    this.scale = Math.min(r.width / 445, r.height / 280, 1.72);
    this.cx = r.width * .45; this.cy = r.height * .44;
  }
  point(x,y) { return { x:(x-this.cx)/this.scale, y:(y-this.cy)/this.scale }; }
  ellipse(x,y,rx,ry,fill,rotation=0,stroke) {
    const c=this.ctx;c.beginPath();c.ellipse(x,y,rx,ry,rotation,0,Math.PI*2);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.stroke();}
  }
  line(points,color,width=1) {
    const c=this.ctx;c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.strokeStyle=color;c.lineWidth=width;c.stroke();
  }
  leg(points,far) {
    const c=this.ctx; const color=far?'#b49c74':'#8b704b';
    this.line(points,color,far?2.7:3.8);
    for(let i=1;i<points.length;i++){
      const [x,y]=points[i];this.ellipse(x,y,2.1,2.1,color);
      const [px,py]=points[i-1];
      for(let j=1;j<5;j++) {const t=j/5;this.line([[px+(x-px)*t,py+(y-py)*t],[px+(x-px)*t-3,py+(y-py)*t-4]],color,.55);}
    }
    const p=points[points.length-1];this.line([p,[p[0]+6,p[1]+1],[p[0]+8,p[1]-1]],color,.8);
  }
  wing(x,y,angle) {
    const c=this.ctx;c.save();c.translate(x,y);c.rotate(angle);
    c.beginPath();c.moveTo(0,0);c.bezierCurveTo(-25,-31,-142,-50,-166,-22);c.bezierCurveTo(-183,1,-77,18,0,0);
    c.fillStyle='rgba(222,223,210,.51)';c.fill();c.strokeStyle='#aaa995';c.lineWidth=.8;c.stroke();
    for(const pts of [[[0,0],[-49,-13],[-132,-26],[-162,-23]],[[0,0],[-60,-3],[-155,-11]],[[0,0],[-70,5],[-135,-1]],[[-58,-13],[-65,-3],[-71,5]],[[-112,-24],[-122,-7]]])this.line(pts,'rgba(131,135,117,.6)',.65);
    c.restore();
  }
  draw(body,active=false) {
    const c=this.ctx;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,this.width,this.height);
    c.translate(this.cx,this.cy);c.scale(this.scale,this.scale);c.lineCap='round';c.lineJoin='round';
    // A single contact surface; the specimen stays fixed in this experiment.
    this.line([[-196,97],[223,97]],'#dedbd0',.65);
    this.ellipse(-9,96,128,3,'rgba(96,84,52,.05)');
    this.leg([[-13,-2],[-42,21],[-64,50],[-91,89],[-98,95]],true);
    this.leg([[0,-3],[20,28],[0,62],[18,91],[30,95]],true);
    this.leg([[25,-1],[52,22],[56,56],[83,86],[88,94]],true);
    // Abdomen: tapered female outline and dark tergite margins.
    c.save();c.translate(-69,-12);c.rotate(-.08);
    c.beginPath();c.moveTo(52,-20);c.bezierCurveTo(10,-39,-54,-25,-75,-3);c.bezierCurveTo(-57,22,0,31,47,13);c.closePath();
    c.fillStyle='#b2945a';c.fill();c.save();c.clip();
    for(let i=0;i<6;i++){const x=-61+i*21;c.beginPath();c.moveTo(x,-40);c.quadraticCurveTo(x+18,0,x-2,36);c.lineTo(x+7,36);c.quadraticCurveTo(x+26,0,x+8,-40);c.fillStyle='#544b34';c.fill();}
    c.restore();c.strokeStyle='#6f6244';c.lineWidth=1;c.stroke();c.restore();
    // Far wing and haltere precede thorax; wings attach to the mesothorax.
    this.wing(9,-39,.17);
    this.line([[-24,-16],[-39,-24]],'#997846',2);this.ellipse(-41,-25,5,3.5,'#c3aa73');
    this.ellipse(-1,-25,43,31,'#ac8b53',-.22,'#806d49');
    this.ellipse(9,-36,26,17,'rgba(194,163,101,.45)',-.25);
    for(let i=0;i<6;i++){const x=-28+i*11;this.line([[x,-47+(i-2)**2*.65],[x-9,-61+(i-2)**2*.5]],'#5e533c',.85);}
    this.line([[-20,-6],[-29,7]],'#5e533c',.8);
    this.leg([[-18,-5],[-32,26],[-57,56],[-55,83],[-67,95]],false);
    this.leg([[5,-4],[27,25],[12,54],[40,89],[51,95]],false);
    this.leg([[28,-9],[55,15],[63,43],[103,76],[110,94]],false);
    this.wing(10,-38,-.07);
    // Neck, head capsule, compound eye, antenna and branched arista.
    this.line([[32,-25],[52,-27]],'#8b784b',12);
    this.ellipse(69,-27,27,29,'#bda16d',-.12,'#88734e');
    this.ellipse(71,-31,17,23,'#a3402e',-.22,'#823727');
    c.save();c.translate(71,-31);c.rotate(-.22);c.beginPath();c.ellipse(0,0,16,22,0,0,Math.PI*2);c.clip();
    for(let y=-22;y<=22;y+=3.8)for(let x=-18;x<18;x+=3.8)this.ellipse(x+(Math.round(y/3.8)%2)*1.8,y,.63,.63,'rgba(246,192,135,.25)');c.restore();
    this.ellipse(66,-39,6,10,'rgba(210,107,73,.25)',-.2);
    this.ellipse(94,-29,4,6,'#b38f56',-.6);this.ellipse(100,-24,3,6,'#9c7b45',-.45);
    this.line([[100,-29],[113,-43],[122,-47]],'#726344',.8);
    for(let i=0;i<5;i++){const x=107+i*3,y=-36-i*2;this.line([[x,y],[x-2,y-7]],'#726344',.55);this.line([[x,y],[x+6,y+2]],'#726344',.55);}
    for(const a of [-2.1,-1.5,-.9])this.line([[69+24*Math.cos(a),-27+26*Math.sin(a)],[69+35*Math.cos(a),-27+37*Math.sin(a)]],'#64573e',.8);
    // Mouthparts are drawn from the same geometry used by contact sensing.
    const {base,elbow,tip}=body.joints;
    this.line([[base.x,base.y],[elbow.x,elbow.y]],'#aa8e5b',8);
    this.line([[base.x-1,base.y],[elbow.x-1,elbow.y]],'#d5bd87',3);
    this.line([[elbow.x,elbow.y],[tip.x,tip.y]],'#9d8051',5.5);
    this.ellipse(tip.x-2,tip.y,5,6,'#bda377',-.25,'#8d7955');
    this.ellipse(tip.x+3,tip.y+1,4,5,'#ceb78b',-.25,'#98825b');
    for(let i=-2;i<=2;i++)this.line([[tip.x-4,tip.y+i*1.8],[tip.x+5,tip.y+i*1.8+1]],'#968367',.45);
    // Transparent capillary and meniscus. Composition has no invented color.
    const d=body.drop;
    this.line([[d.x+d.radius-1,d.y-7],[d.x+111,d.y-7]],'#c9d0cc',1);
    this.line([[d.x+d.radius-1,d.y+7],[d.x+111,d.y+7]],'#c9d0cc',1);
    this.ellipse(d.x,d.y,d.radius,d.radius,'rgba(207,222,215,.22)',0,active?'#7d9287':'#9eada5');
    c.beginPath();c.arc(d.x-2,d.y-2,d.radius-5,3.6,4.8);c.strokeStyle='rgba(255,255,255,.95)';c.lineWidth=2;c.stroke();
    if(body.contact)this.ellipse(tip.x,tip.y,2,2,'#526d5d');
    c.fillStyle='#77786a';c.font='7px -apple-system, sans-serif';c.textAlign='center';c.fillText('labellar contact',104,121);
    this.line([[103,112],[tip.x,tip.y+10]],'#c5c1b4',.55);
    c.fillStyle='#898577';c.textAlign='left';c.fillText('held specimen · lateral view',-166,121);
  }
}
