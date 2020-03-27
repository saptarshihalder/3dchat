// 3D algorithm and code by mrHackman
// No 3D libraries

var camera, vertices;
var locations = {};
var down = Array(1000).fill(0);
var frame = 1;
window.onload = function() {
  gl_setup();
  setup_text_canvas();
  this.name = prompt("What is your SL name?")||user_id;
  write_data(name, name_id);
  alert("Text rendering is improved.");
  write_data("1", "online"+user_id);
  var ref = firebase.database().ref("User/"+"online"+user_id);
  ref.onDisconnect().set("0");
  camera = new Camera;
  write_data(''+camera.position, user_id);
  vertices = new Float32Array([]);
  add_vertices(vertices);
  document.addEventListener("keydown", function(e) {
    down[e.which] = 1;
  });
  document.addEventListener("keyup", function(e) {
    down[e.which] = 0;
  });
  document.getElementById("W").addEventListener("touchstart", function() {
    down[87] = 1;
  });
  document.getElementById("W").addEventListener("touchend", function() {
    down[87] = 0;
  });
  document.getElementById("A").addEventListener("touchstart", function() {
    down[65] = 1;
  });
  document.getElementById("A").addEventListener("touchend", function() {
    down[65] = 0;
  });
  document.getElementById("S").addEventListener("touchstart", function() {
    down[83] = 1;
  });
  document.getElementById("S").addEventListener("touchend", function() {
    down[83] = 0;
  });
  document.getElementById("D").addEventListener("touchstart", function() {
    down[68] = 1;
  });
  document.getElementById("D").addEventListener("touchend", function() {
    down[68] = 0;
  });
  document.getElementById("up").addEventListener("touchstart", function() {
    down[38] = 1;
  });
  document.getElementById("up").addEventListener("touchend", function() {
    down[38] = 0;
  });
  document.getElementById("left").addEventListener("touchstart", function() {
    down[37] = 1;
  });
  document.getElementById("left").addEventListener("touchend", function() {
    down[37] = 0;
  });
  document.getElementById("down").addEventListener("touchstart", function() {
    down[40] = 1;
  });
  document.getElementById("down").addEventListener("touchend", function() {
    down[40] = 0;
  });
  document.getElementById("right").addEventListener("touchstart", function() {
    down[39] = 1;
  });
  document.getElementById("right").addEventListener("touchend", function() {
    down[39] = 0;
  });

  window.requestAnimationFrame(loop);
}

function loop() {
  if (frame%10 === 0) {
    write_data(''+camera.position.map(n => Math.round(n*100)/100), user_id);
    locations = read_data();
    update_scene(locations);
  }
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT||gl.DEPTH_BUFFER_BIT);
  camera.shift(
    v_add_v(
      v_add_v(
        s_mult_v(camera.move_speed*down[87], camera.axes[2]),
        s_mult_v(-camera.move_speed*down[83], camera.axes[2])
      ),
      v_add_v(
        s_mult_v(camera.move_speed*down[68], camera.axes[0]),
        s_mult_v(-camera.move_speed*down[65], camera.axes[0])
      )
    )
  );
  camera.rotate_ki(down[39]-down[37]);
  camera.rotate_jk(down[38]-down[40]);
  camera.rotate_ji(down[16]-down[13]);
  camera.send_values_to_shader();
  if (frame>50) {
    matrix = camera.matrix();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (loc of temp_text) {
      var neww = m_mult_v(matrix, v_add_v(loc[0], s_mult_v(-1, camera.position)));
      var p = camera.focal_length/(neww[2]+camera.focal_length);
      if (neww[2] >= 0.0) {
        ctx.fillStyle = ["white", "green"][loc[2]];
        ctx.font = ["10px sans-serif", "20px sans-serif"][loc[2]];
        ctx.fillText(loc[1], (neww[0]*p+1)*canvas.width/2, (canvas.height-(1-neww[1]*p*w_h)*canvas.height/2));
      }
    }
  }
  gl.drawArrays(gl.TRIANGLES, 0, vertices.length/6);
  frame++;
  window.requestAnimationFrame(loop);
}