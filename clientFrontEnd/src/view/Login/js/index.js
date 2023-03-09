const ipc = require('electron').ipcRenderer;

$('#login-button').click(function(){
  $('#login-button').fadeOut("slow",function(){
    $("#container").fadeIn();
    TweenMax.from("#container", .4, { scale: 0, ease:Sine.easeInOut});
    TweenMax.to("#container", .4, { scale: 1, ease:Sine.easeInOut});
  });
});

$('#login_with_privkey').click(function() {
  $('#container').fadeOut(function(){
    $("#alter-container").fadeIn();
  });
});

$('#login_with_userid').click(function() {
  $('#alter-container').fadeOut("slow",function(){
    $("#container").fadeIn();
  });
})

$(".close-btn").click(function(){
  TweenMax.from("#container", .4, { scale: 1, ease:Sine.easeInOut});
  TweenMax.to("#container", .4, { left:"0px", scale: 0, ease:Sine.easeInOut});
  $("#container, #forgotten-container, #register-container, #alter-container").fadeOut(800, function(){
    $("#login-button").fadeIn(800);
  });
});

/* Forgotten Password */
$('#forgotten').click(function(){
  $("#container").fadeOut(function(){
    $("#forgotten-container").fadeIn();
  });
});

// Register Button Clicked
$('#container-register-btn').click(function(){
  //clear login data
  setTimeout(() => {
    $('#login_id').removeClass('warning');
    $('#login_pass').removeClass('warning');
    $(".error_text").addClass('none');
    $('#login_id').val('');
    $('#login_pass').val('');
  }, 1000);

  $("#container").fadeOut("slow",function(){
    $("#register-container").fadeIn();
  });
});
$('#alter-container-register-btn').click(function(){
  $("#alter-container").fadeOut("slow",function(){
    $("#register-container").fadeIn();
  });
});

$('#create').click(function(){
  $("#container").fadeOut(function(){
    $("#register-container").fadeIn();
  });
  $("#container, #select-container").fadeOut(800, function(){
    $("#register-container").fadeIn(800);
  });
});

$('#back').click(function(){
  $("#register-container").fadeOut(function(){
    $("#container").fadeIn();
  });
});

$("#random_close_btn").click(function(){
  $("#random-container").fadeOut(800);
});

$("#random_back").click(function(){
  $("#random-container").fadeOut(800);
});

// Main Process
$('#login').click(function(){
  var userId = $('#login_id').val();
  var password = $('#login_pass').val();
  if (userId != "" || password != ""){
    ipc.send('login', {userId:userId, password:password}, 10);
  }
});

$('#register').click(function(){
  var userId = $('#register_id').val();
  var firstName = $('#first_name').val();
  var lastName = $('#last_name').val();
  var password = $('#register_pass').val();
  var confirm = $('#register_confirm').val();
  if (userId =="") {
    $("#register_form .error_text").removeClass('none');
    $("#register_form .error_text").text('id required');
    $('#register_id').addClass('warning');
    $('#first_name').removeClass('warning');
    $('#last_name').removeClass('warning');
    $('#register_pass').removeClass('warning');
    $('#register_confirm').removeClass('warning');
  }else if (firstName ==""){
    $("#register_form .error_text").removeClass('none');
    $("#register_form .error_text").text('first name required');
    $('#register_id').removeClass('warning');
    $('#first_name').addClass('warning');
    $('#last_name').removeClass('warning');
    $('#register_pass').removeClass('warning');
    $('#register_confirm').removeClass('warning');
  }else if (lastName ==""){
    $("#register_form .error_text").removeClass('none');
    $("#register_form .error_text").text('last name required');
    $('#register_id').removeClass('warning');
    $('#first_name').removeClass('warning');
    $('#last_name').addClass('warning');
    $('#register_pass').removeClass('warning');
    $('#register_confirm').removeClass('warning');
  }else if (password ==""){
    $("#register_form .error_text").removeClass('none');
    $("#register_form .error_text").text('password required');
    $('#register_id').removeClass('warning');
    $('#first_name').removeClass('warning');
    $('#last_name').removeClass('warning');
    $('#register_pass').addClass('warning');
    $('#register_confirm').removeClass('warning');
  }else if(confirm ==""){
    $("#register_form .error_text").removeClass('none');
    $("#register_form .error_text").text('confirm password required');
    $('#register_id').removeClass('warning');
    $('#first_name').removeClass('warning');
    $('#last_name').removeClass('warning');
    $('#register_pass').removeClass('warning');
    $('#register_confirm').addClass('warning');
  }else if(password != confirm){
    $("#register_form .error_text").removeClass('none');
    $("#register_form .error_text").text('password confirmation doesn\'t match');
    $('#register_id').removeClass('warning');
    $('#first_name').removeClass('warning');
    $('#last_name').removeClass('warning');
    $('#register_pass').removeClass('warning');
    $('#register_confirm').addClass('warning');
  }else {
      $("#random-container").fadeIn();
    //ipc.send('register',{userId: userId, password:password}, 10);
  }
});

$('#random').click(function(){
  $("#register_form .error_text").addClass('none');
  $("#register_form .error_text").text('password confirmation doesn\'t match');
  $('#register_id').removeClass('warning');
  $('#first_name').removeClass('warning');
  $('#last_name').removeClass('warning');
  $('#register_pass').removeClass('warning');
  $('#register_confirm').removeClass('warning');

  var userId = $('#register_id').val();
  var firstName = $('#first_name').val();
  var lastName = $('#last_name').val();
  var password = $('#register_pass').val();
  var random = $('#random_text').val();
  if (random.length < 20) {
  $("#randomtext_form .error_text").removeClass('none');
  $('#random_text').addClass('warning');
  } else {
    var registerData = {
      userId : userId,
      firstName : firstName,
      lastName : lastName,
      password : password,
      randomText : random
    }
    ipc.send('register', registerData);
    setTimeout(() => {
      $("#randomtext_form .error_text").addClass('none');
      $('#random_text').removeClass('warning');
    }, 1000);
    $("#random-container").fadeOut();
  }
});
ipc.on('login_response', (event, data) => {
  var state = data.state;
  var reason = data.reason;
  console.log(data);
  $("#login_form .error_text").removeClass('none');
  if(reason == "userid") {
    $('#login_id').addClass('warning');
    $('#login_pass').removeClass('warning');
  }
  else if(reason == "password") {
    $('#login_id').removeClass('warning');
    $('#login_pass').addClass('warning');
  }
})
ipc.on('register_response', (event, data) => {
  var state = data.state;
  var reason = data.reason;
  if(state == true) {
    $('#register-container').fadeOut("slow",function(){
      $("#container").fadeIn();
      TweenMax.from("#container", .4, { scale: 0, ease:Sine.easeInOut});
      TweenMax.to("#container", .4, { scale: 1, ease:Sine.easeInOut});
      setTimeout(() => {
        $('#register_id').val('');
        $('#first_name').val('');
        $('#last_name').val('');
        $('#register_pass').val('');
        $('#register_confirm').val('');
        $('#random_text').val('');
      }, 1000);
    });
    $("#container").fadeIn();
    TweenMax.from("#container", .4, { scale: 0, ease:Sine.easeInOut});
    TweenMax.to("#container", .4, { scale: 1, ease:Sine.easeInOut});
  }
  else {
    if(reason == "Duplicated ID") {
      $("#register_form .error_text").removeClass('none');
      $("#register_form .error_text").text('id duplicated');
      $('#register_id').addClass('warning');
    }
    else {
      $("#register_form .error_text").removeClass('none');
      $("#register_form .error_text").text('Please try again later');
    }
  }
})