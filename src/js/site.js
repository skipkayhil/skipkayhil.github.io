$(document).ready(function(){
  cycleColors();

  $('.ui.dropdown').dropdown();

  $('.logo').hover(
    function(){
      $('.logo')
        .transition('set looping')
        .transition('tada', 750)
    ; },
    function(){
      $('.logo')
        .transition('stop')
        .transition('remove looping')
    ; }
  );

  $('.logo').click(
      function(){
        $('.logo')
          .transition('stop')
          .transition('remove looping')
    ; }
  );

  setInterval(function() {
      cycleColors();
    }, 15000);

  function cycleColors() {
    $('.logo').animate({
      backgroundColor: '#395c78'
    }, 5000);
    $('.logo').animate({
      backgroundColor: '#ef9849'
    }, 5000);
    $('.logo').animate({
      backgroundColor: '#bd3b3b'
    }, 5000);
  }
});
