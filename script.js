// 3D algorithm and code by mrHackman / Saptarshi Halder
// No 3D libraries. The camera, projection, matrices and geometry are handwritten WebGL.

var canvas, text, ctx, gl, program, vbo, pal, cal;
var matrix_location, camera_location, f_location, w_h_location, w_h;
var camera, vertices = new Float32Array([]);
var down = Array(1000).fill(0);
var frame = 1;
var entered = false;
var user_id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
var name = "";
var peers = {};
var temp_text = [];
var static_vertices = [];
var channel = null;
var room = new URLSearchParams(location.search).get("room") || "main-lobby";
var p2pRoom = null, p2pState = null, p2pChat = null, p2pHello = null;
var transportToUser = {};
var lastSend = 0;
var lastHeartbeat = 0;
var player_position = [8, 0, 0.35];
var local_message = "";
var local_message_until = 0;
var follow_distance = 4.4;
var follow_height = 1.15;

class Camera {
  constructor(position=[8, 0, 0.35], axes=[[0, 1, 0], [0, 0, -1], [-1, 0, 0]], focal_length=2, move_speed=.11, rot_speed=.035) {
    this.position = position;
    this.axes = axes;
    this.focal_length = focal_length;
    this.move_speed = move_speed;
    this.rot_speed = rot_speed;
    this.a = Math.cos(this.rot_speed);
    this.b = Math.sin(this.rot_speed);
  }
  matrix() {
    return inverse(transpose(this.axes));
  }
  shift(dir) {
    this.position = v_add_v(this.position, dir);
    this.position[0] = clamp(this.position[0], -42, 42);
    this.position[1] = clamp(this.position[1], -42, 42);
  }
  rotate_ki(n) {
    var temp_k = v_add_v(s_mult_v(n?this.a:1, this.axes[2]), s_mult_v(n*this.b, this.axes[0]));
    this.axes[0] = v_add_v(s_mult_v(n?this.a:1, this.axes[0]), s_mult_v(n*this.b, s_mult_v(-1, this.axes[2])));
    this.axes[2] = temp_k;
  }
  rotate_jk(n) {
    var temp_j = v_add_v(s_mult_v(n?this.a:1, this.axes[1]), s_mult_v(n*this.b, this.axes[2]));
    this.axes[2] = v_add_v(s_mult_v(n?this.a:1, this.axes[2]), s_mult_v(n*this.b, s_mult_v(-1, this.axes[1])));
    this.axes[1] = temp_j;
  }
  rotate_ji(n) {
    var temp_j = v_add_v(s_mult_v(n?this.a:1, this.axes[1]), s_mult_v(n*this.b, this.axes[0]));
    this.axes[0] = v_add_v(s_mult_v(n?this.a:1, this.axes[0]), s_mult_v(n*this.b, s_mult_v(-1, this.axes[1])));
    this.axes[1] = temp_j;
  }
  send_values_to_shader() {
    gl.uniformMatrix3fv(matrix_location, false, flatten(this.matrix()));
    gl.uniform3fv(camera_location, this.position);
    gl.uniform1f(f_location, this.focal_length);
  }
}

function gl_setup() {
  canvas = document.getElementById("canvas");
  gl = canvas.getContext("webgl", {antialias:true}) || canvas.getContext("experimental-webgl");
  if (!gl) throw new Error("WebGL is not available in this browser");

  resize();

  var vs_source =
    "precision mediump float;\n" +
    "attribute vec3 vert_pos;\n" +
    "attribute vec3 vert_color;\n" +
    "varying vec3 frag_color;\n" +
    "uniform mat3 u_matrix;\n" +
    "uniform vec3 u_camera;\n" +
    "uniform float f;\n" +
    "uniform float w_h;\n" +
    "vec3 proj3Dto2D(vec3 vp){\n" +
    "  vec3 view_pos = vp*u_matrix;\n" +
    "  float p = f/(view_pos.z+f);\n" +
    "  if(view_pos.z>=0.0){ return vec3(view_pos.x*p,-view_pos.y*p*w_h,min(.98,view_pos.z*.008)); }\n" +
    "  return vec3(2.0,2.0,2.0);\n" +
    "}\n" +
    "void main(){ frag_color=vert_color; gl_Position=vec4(proj3Dto2D(vert_pos-u_camera),1.0); }\n";

  var fs_source =
    "precision mediump float;\n" +
    "varying vec3 frag_color;\n" +
    "void main(){ gl_FragColor=vec4(frag_color,1.0); }\n";

  program = prgm(vs_source, fs_source);
  matrix_location = gl.getUniformLocation(program, "u_matrix");
  camera_location = gl.getUniformLocation(program, "u_camera");
  f_location = gl.getUniformLocation(program, "f");
  w_h_location = gl.getUniformLocation(program, "w_h");

  vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  pal = gl.getAttribLocation(program, "vert_pos");
  cal = gl.getAttribLocation(program, "vert_color");

  gl.vertexAttribPointer(pal, 3, gl.FLOAT, false, 6*Float32Array.BYTES_PER_ELEMENT, 0);
  gl.enableVertexAttribArray(pal);
  gl.vertexAttribPointer(cal, 3, gl.FLOAT, false, 6*Float32Array.BYTES_PER_ELEMENT, 3*Float32Array.BYTES_PER_ELEMENT);
  gl.enableVertexAttribArray(cal);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clearDepth(1);
}

function prgm(vs_source, fs_source) {
  var vs = gl.createShader(gl.VERTEX_SHADER);
  var fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(vs, vs_source);
  gl.shaderSource(fs, fs_source);
  gl.compileShader(vs);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error("Vertex shader: " + gl.getShaderInfoLog(vs));
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error("Fragment shader: " + gl.getShaderInfoLog(fs));

  var p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("Shader link: " + gl.getProgramInfoLog(p));
  gl.useProgram(p);
  return p;
}

function add_vertices(v) {
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
}

function inverse(mat3) {
  var minors=[[],[],[]], cofactors=[[],[],[]], adjugate=[[],[],[]], count=[0,1,2];
  for (var ii of count) {
    for (var jj of count) {
      var vals=[];
      for (var kk of count.filter(function(n){return n!==ii;})) {
        for (var ll of count.filter(function(n){return n!==jj;})) vals.push(mat3[kk][ll]);
      }
      minors[ii][jj]=vals[0]*vals[3]-vals[1]*vals[2];
      cofactors[ii][jj]=minors[ii][jj]*(((ii+jj)&1)?-1:1);
      adjugate[jj][ii]=cofactors[ii][jj];
    }
  }
  var d=mat3[0][0]*minors[0][0]-mat3[0][1]*minors[0][1]+mat3[0][2]*minors[0][2];
  return adjugate.map(function(arr){return arr.map(function(n){return n/d;});});
}

function transpose(mat3) {
  return [[mat3[0][0],mat3[1][0],mat3[2][0]],[mat3[0][1],mat3[1][1],mat3[2][1]],[mat3[0][2],mat3[1][2],mat3[2][2]]];
}

function flatten(mat) { return mat.flat(1); }

function v_add_v(a,b) {
  var sum=[];
  for(var i=0;i<a.length;i++) sum.push(a[i]+b[i]);
  return sum;
}

function s_mult_v(a,b) { return b.map(function(n){return a*n;}); }

function m_mult_v(m,v) {
  var out=[];
  for(var i=0;i<m.length;i++) {
    var sum=0;
    for(var j=0;j<m.length;j++) sum+=m[i][j]*v[j];
    out.push(sum);
  }
  return out;
}

function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }

function horizontal_unit(v) {
  var d=Math.sqrt(v[0]*v[0]+v[1]*v[1]);
  if(d<0.0001) return [0,0,0];
  return [v[0]/d,v[1]/d,0];
}

function update_camera_follow() {
  var f=horizontal_unit(camera.axes[2]);
  camera.position=[
    player_position[0]-f[0]*follow_distance,
    player_position[1]-f[1]*follow_distance,
    player_position[2]+follow_height
  ];
}

function move_player() {
  var f=horizontal_unit(camera.axes[2]);
  var r=horizontal_unit(camera.axes[0]);
  var dx=(f[0]*(down[87]-down[83])+r[0]*(down[68]-down[65]))*camera.move_speed;
  var dy=(f[1]*(down[87]-down[83])+r[1]*(down[68]-down[65]))*camera.move_speed;
  if(dx||dy) {
    player_position[0]=clamp(player_position[0]+dx,-42,42);
    player_position[1]=clamp(player_position[1]+dy,-42,42);
    rebuild_scene();
    return true;
  }
  return false;
}

function shade(c,k) { return [clamp(c[0]*k,0,1),clamp(c[1]*k,0,1),clamp(c[2]*k,0,1)]; }

function vertex(out,p,c) { out.push(p[0],p[1],p[2],c[0],c[1],c[2]); }

function quad(out,a,b,c,d,color) {
  vertex(out,a,color); vertex(out,b,color); vertex(out,c,color);
  vertex(out,a,color); vertex(out,d,color); vertex(out,c,color);
}

function box(out, center, size, color) {
  var x=center[0], y=center[1], z=center[2], hx=size[0]/2, hy=size[1]/2, hz=size[2]/2;
  var p000=[x-hx,y-hy,z-hz], p001=[x-hx,y-hy,z+hz], p010=[x-hx,y+hy,z-hz], p011=[x-hx,y+hy,z+hz];
  var p100=[x+hx,y-hy,z-hz], p101=[x+hx,y-hy,z+hz], p110=[x+hx,y+hy,z-hz], p111=[x+hx,y+hy,z+hz];
  quad(out,p100,p110,p111,p101,shade(color,.88));
  quad(out,p000,p001,p011,p010,shade(color,.62));
  quad(out,p010,p011,p111,p110,shade(color,.78));
  quad(out,p000,p100,p101,p001,shade(color,.55));
  quad(out,p001,p101,p111,p011,shade(color,1.05));
  quad(out,p000,p010,p110,p100,shade(color,.45));
}

function floorQuad(out,x1,y1,x2,y2,z,color) {
  quad(out,[x1,y1,z],[x2,y1,z],[x2,y2,z],[x1,y2,z],color);
}

function build_world() {
  var out=[];
  floorQuad(out,-50,-50,50,50,-1.05,[.045,.065,.09]);
  floorQuad(out,-11,-11,11,11,-1.035,[.12,.18,.26]);

  for(var g=-40;g<=40;g+=4) {
    floorQuad(out,g-.018,-40,g+.018,40,-1.025,[.12,.18,.24]);
    floorQuad(out,-40,g-.018,40,g+.018,-1.025,[.12,.18,.24]);
  }

  var buildings=[
    [-14,-15,5,5,6],[-14,15,5,5,9],[14,-15,5,5,8],[14,15,5,5,7],
    [-25,-5,6,5,10],[-25,8,5,7,6],[25,-6,5,7,7],[25,8,6,5,11],
    [-7,-25,6,5,5],[8,-25,7,5,8],[-7,25,5,6,9],[8,25,6,5,6]
  ];
  for(var i=0;i<buildings.length;i++) {
    var b=buildings[i], h=b[4], col=(i%2)?[.12,.24,.38]:[.16,.29,.43];
    box(out,[b[0],b[1],-1+h/2],[b[2],b[3],h],col);
    for(var wz=0;wz<Math.floor(h/1.6);wz++) {
      var z=-.25+wz*1.45;
      box(out,[b[0]+(b[0]<0?b[2]/2+.015:-b[2]/2-.015),b[1],z],[.035,b[3]*.55,.42],[.35,.72,.95]);
    }
  }

  var pillars=[[-8,-8],[-8,8],[8,-8],[8,8]];
  for(var p of pillars) {
    box(out,[p[0],p[1],1.25],[.7,.7,4.5],[.27,.43,.62]);
    box(out,[p[0],p[1],3.7],[1.15,1.15,.35],[.35,.72,1]);
  }

  box(out,[-4,0,-.25],[1.2,1.2,1.5],[.33,.78,.63]);
  box(out,[0,-4,-.25],[1.2,1.2,1.5],[.67,.38,.84]);
  box(out,[0,4,-.25],[1.2,1.2,1.5],[.88,.56,.24]);

  static_vertices=out;
}

function color_from_id(id) {
  var h=0;
  for(var i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))>>>0;
  var r=.28+((h&255)/255)*.55, g=.28+(((h>>8)&255)/255)*.55, b=.28+(((h>>16)&255)/255)*.55;
  return [r,g,b];
}

function add_avatar(out,pos,c) {
  box(out,[pos[0],pos[1],pos[2]-.45],[.82,.72,1.35],c);
  box(out,[pos[0],pos[1],pos[2]+.55],[.62,.62,.62],shade(c,1.08));
  box(out,[pos[0]-.18,pos[1],pos[2]-1.05],[.24,.28,.55],shade(c,.72));
  box(out,[pos[0]+.18,pos[1],pos[2]-1.05],[.24,.28,.55],shade(c,.72));
}

function rebuild_scene() {
  var out=static_vertices.slice();
  temp_text=[];

  if(entered) {
    var selfColor=color_from_id(user_id);
    add_avatar(out,player_position,selfColor);
    temp_text.push({position:[player_position[0],player_position[1],player_position[2]+1.2],text:name || "you",kind:"name"});
    if(local_message && performance.now()<local_message_until) {
      temp_text.push({position:[player_position[0],player_position[1],player_position[2]+1.75],text:local_message,kind:"chat"});
    }
  }

  for(var id in peers) {
    var peer=peers[id];
    var pos=peer.position;
    if(!pos || pos.length<3) continue;
    var c=peer.color || color_from_id(id);
    add_avatar(out,pos,c);
    temp_text.push({position:[pos[0],pos[1],pos[2]+1.15],text:peer.name || "visitor",kind:"name"});
    if(peer.message && performance.now()<peer.messageUntil) {
      temp_text.push({position:[pos[0],pos[1],pos[2]+1.72],text:peer.message,kind:"chat"});
    }
  }

  vertices=new Float32Array(out);
  add_vertices(vertices);
  document.getElementById("online").textContent=(1+Object.keys(peers).length)+" user"+(Object.keys(peers).length?"s":"")+" online";
}

function setup_text_canvas() {
  text=document.getElementById("text");
  ctx=text.getContext("2d");
  ctx.textAlign="center";
  resize();
}

function project_label(point) {
  var matrix=camera.matrix();
  var rel=v_add_v(point,s_mult_v(-1,camera.position));
  var q=m_mult_v(matrix,rel);
  if(q[2]<.05) return null;
  var p=camera.focal_length/(q[2]+camera.focal_length);
  var x=(q[0]*p+1)*canvas.width/2;
  var y=(1+q[1]*p*w_h)*canvas.height/2;
  if(x<-200||x>canvas.width+200||y<-100||y>canvas.height+100) return null;
  return [x,y,q[2]];
}

function rounded(ctx,x,y,w,h,r) {
  var rr=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr);
  ctx.closePath();
}

function draw_text() {
  ctx.clearRect(0,0,text.width,text.height);
  for(var item of temp_text) {
    var s=project_label(item.position);
    if(!s) continue;
    var distance=s[2];
    var fontSize=clamp(20-distance*.18,11,20);
    ctx.font=(item.kind==="chat"?"600 ":"500 ")+fontSize+"px system-ui,sans-serif";
    var width=Math.min(330,ctx.measureText(item.text).width+20);
    var height=fontSize+13;
    ctx.fillStyle=item.kind==="chat"?"rgba(239,246,255,.94)":"rgba(5,9,15,.76)";
    rounded(ctx,s[0]-width/2,s[1]-height,width,height,9);
    ctx.fill();
    ctx.fillStyle=item.kind==="chat"?"#111827":"#f5f8fc";
    ctx.fillText(item.text.slice(0,100),s[0],s[1]-7+fontSize*.72);
  }
}

function resize() {
  var dpr=Math.min(window.devicePixelRatio||1,1.5);
  if(canvas) {
    canvas.width=Math.floor(innerWidth*dpr);
    canvas.height=Math.floor(innerHeight*dpr);
    canvas.style.width=innerWidth+"px";
    canvas.style.height=innerHeight+"px";
    if(gl) {
      gl.viewport(0,0,canvas.width,canvas.height);
      w_h=canvas.width/canvas.height;
      if(w_h_location) gl.uniform1f(w_h_location,w_h);
    }
  }
  if(text) {
    text.width=Math.floor(innerWidth*dpr);
    text.height=Math.floor(innerHeight*dpr);
    text.style.width=innerWidth+"px";
    text.style.height=innerHeight+"px";
    if(ctx) ctx.setTransform(1,0,0,1,0,0);
  }
}

function append_message(who,msg,system) {
  var box=document.getElementById("messages");
  var line=document.createElement("div");
  line.className="message"+(system?" system":"");
  if(system) line.textContent=msg;
  else {
    var b=document.createElement("b");
    b.textContent=who+": ";
    line.appendChild(b);
    line.appendChild(document.createTextNode(msg));
  }
  box.appendChild(line);
  while(box.children.length>15) box.removeChild(box.firstChild);
  box.scrollTop=box.scrollHeight;
}

function state_packet(type) {
  return {type:type||"state",user_id:user_id,name:name,position:player_position.slice(),color:color_from_id(user_id),t:Date.now()};
}

function receive_packet(data,transport) {
  if(!data||data.user_id===user_id) return;
  if(transport && transport!=="tab") transportToUser[transport]=data.user_id;

  if(!peers[data.user_id]) peers[data.user_id]={position:[0,0,.35],name:"visitor",color:color_from_id(data.user_id),message:"",messageUntil:0,lastSeen:0};
  var peer=peers[data.user_id];
  peer.lastSeen=performance.now();
  if(data.name) peer.name=String(data.name).slice(0,24);
  if(data.color) peer.color=data.color;

  if((data.type==="state"||data.type==="hello")&&Array.isArray(data.position)&&data.position.length>=3) {
    peer.position=data.position.slice(0,3).map(Number);
  }
  if(data.type==="chat"&&data.message) {
    peer.message=String(data.message).slice(0,100);
    peer.messageUntil=performance.now()+8000;
    append_message(peer.name,peer.message,false);
  }
  rebuild_scene();
}

function broadcast_local(data) {
  if(channel) channel.postMessage(data);
}

function send_state(force) {
  var now=performance.now();
  if(!force && now-lastSend<90) return;
  lastSend=now;
  var data=state_packet("state");
  broadcast_local(data);
  if(p2pState) p2pState.send(data).catch(function(){});
}

function send() {
  var input=document.getElementById("msg");
  var msg=input.value.trim().slice(0,100);
  if(!msg) return;
  input.value="";
  append_message(name,msg,false);
  local_message=msg;
  local_message_until=performance.now()+8000;
  rebuild_scene();
  var data=state_packet("chat");
  data.message=msg;
  broadcast_local(data);
  if(p2pChat) p2pChat.send(data).catch(function(){});
}

function connect_network() {
  var status=document.getElementById("network");
  try {
    if("BroadcastChannel" in window) {
      channel=new BroadcastChannel("3dchat:"+room);
      channel.onmessage=function(e){ receive_packet(e.data,"tab"); };
      broadcast_local(state_packet("hello"));
    }
  } catch(e) {}

  status.textContent="connecting peer-to-peer…";
  import("https://esm.run/trystero@0.25.4").then(function(mod){
    p2pRoom=mod.joinRoom({appId:"saptarshi-halder-3dchat-custom-webgl"},room);
    p2pState=p2pRoom.makeAction("state");
    p2pChat=p2pRoom.makeAction("chat");
    p2pHello=p2pRoom.makeAction("hello");

    p2pState.onMessage=function(data,meta){ receive_packet(Object.assign({},data,{type:"state"}),meta.peerId); };
    p2pChat.onMessage=function(data,meta){ receive_packet(Object.assign({},data,{type:"chat"}),meta.peerId); };
    p2pHello.onMessage=function(data,meta){ receive_packet(Object.assign({},data,{type:"hello"}),meta.peerId); };

    p2pRoom.onPeerJoin=function(peerId){
      status.textContent="peer-to-peer online";
      p2pHello.send(state_packet("hello"),{target:peerId}).catch(function(){});
      p2pState.send(state_packet("state"),{target:peerId}).catch(function(){});
    };
    p2pRoom.onPeerLeave=function(peerId){
      var id=transportToUser[peerId];
      if(id&&peers[id]) delete peers[id];
      delete transportToUser[peerId];
      rebuild_scene();
    };
    status.textContent="peer-to-peer ready";
  }).catch(function(err){
    console.warn(err);
    status.textContent="local world · P2P unavailable";
  });
}

function setup_controls() {
  document.addEventListener("keydown",function(e){
    if(document.activeElement===document.getElementById("msg")||document.activeElement===document.getElementById("name")) return;
    if(e.key==="Enter") {
      e.preventDefault();
      document.getElementById("msg").focus();
      return;
    }
    down[e.which||e.keyCode]=1;
    if([37,38,39,40].indexOf(e.which||e.keyCode)>=0) e.preventDefault();
  });
  document.addEventListener("keyup",function(e){ down[e.which||e.keyCode]=0; });

  document.querySelectorAll("[data-key]").forEach(function(el){
    var k=Number(el.getAttribute("data-key"));
    function on(e){e.preventDefault();down[k]=1;}
    function off(e){e.preventDefault();down[k]=0;}
    el.addEventListener("pointerdown",on);
    el.addEventListener("pointerup",off);
    el.addEventListener("pointercancel",off);
    el.addEventListener("pointerleave",off);
  });
}

function enter_lobby() {
  var input=document.getElementById("name");
  name=(input.value.trim()||localStorage.getItem("3dchat-name")||("Guest-"+user_id.slice(0,4))).slice(0,24);
  localStorage.setItem("3dchat-name",name);
  document.getElementById("join").style.display="none";
  entered=true;
  update_camera_follow();
  rebuild_scene();
  append_message("", "Welcome to My Lobby. This entire 3D scene is rendered by the original custom WebGL engine.", true);
  connect_network();
  send_state(true);
}

function loop() {
  try {
    gl.clearColor(.018,.029,.045,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);

    var moved=move_player();
    camera.rotate_ki(down[39]-down[37]);
    camera.rotate_jk(down[38]-down[40]);
    update_camera_follow();
    camera.send_values_to_shader();

    gl.drawArrays(gl.TRIANGLES,0,vertices.length/6);
    draw_text();

    var now=performance.now();
    if(entered && (moved||down[37]||down[38]||down[39]||down[40])) send_state(false);
    if(entered && now-lastHeartbeat>1800) {
      lastHeartbeat=now;
      send_state(true);
    }

    var changed=false;
    if(local_message && now>=local_message_until) {
      local_message="";
      changed=true;
    }
    for(var id in peers) {
      if(peers[id].message && now>=peers[id].messageUntil) {
        peers[id].message="";
        changed=true;
      }
      if(now-peers[id].lastSeen>18000 && Object.values(transportToUser).indexOf(id)<0) {
        delete peers[id];
        changed=true;
      }
    }
    if(changed) rebuild_scene();

    frame++;
    requestAnimationFrame(loop);
  } catch(err) {
    var fatal=document.getElementById("fatal");
    fatal.hidden=false;
    fatal.textContent="3D Chat stopped:\\n\\n"+(err.stack||err);
    throw err;
  }
}

window.addEventListener("load",function(){
  try {
    gl_setup();
    setup_text_canvas();
    setup_controls();
    camera=new Camera();
    update_camera_follow();
    build_world();
    rebuild_scene();

    var saved=localStorage.getItem("3dchat-name");
    if(saved) document.getElementById("name").value=saved;
    document.getElementById("enter").addEventListener("click",enter_lobby);
    document.getElementById("name").addEventListener("keydown",function(e){if(e.key==="Enter") enter_lobby();});
    document.getElementById("chat-form").addEventListener("submit",function(e){e.preventDefault();if(entered) send();});
    window.addEventListener("resize",resize);
    requestAnimationFrame(loop);
  } catch(err) {
    var fatal=document.getElementById("fatal");
    fatal.hidden=false;
    fatal.textContent="3D Chat could not start:\\n\\n"+(err.stack||err);
  }
});

window.addEventListener("beforeunload",function(){
  if(channel) channel.close();
  if(p2pRoom) p2pRoom.leave();
});