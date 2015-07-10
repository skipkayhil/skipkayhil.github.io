$(document).ready(function(){
  cycleColors();

  $('.ui.dropdown').dropdown();

  $('.logo-menu').hover(
    function(){
      $('.logo-menu')
        .transition('set looping')
        .transition('tada', 750)
    ; },
    function(){
      $('.logo-menu')
        .transition('stop')
        .transition('remove looping')
    ; }
  );

  $('.logo-menu').click(
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
      backgroundColor: '#1D608A'
    }, 5000);
    $('.logo').animate({
      backgroundColor: '#C8C652'
    }, 5000);
    $('.logo').animate({
      backgroundColor: '#bd3b3b'
    }, 5000);
  }
});
