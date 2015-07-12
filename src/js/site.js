$(document).ready(function(){
  cycleColors();

  $('#logo-menu').hover(
    function(){
      $('#logo-menu')
        .transition('set looping')
        .transition('tada', 750)
    ; },
    function(){
      $('#logo-menu')
        .transition('stop')
        .transition('remove looping')
    ; }
  );

  $('#logo-menu').click(
      function(){
        $('#logo-menu')
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

  $(window).on('scroll', function(){

    // we round here to reduce a little workload
    stop = Math.round($(window).scrollTop());
    if (stop > 350) {
        $('#nav').removeClass('above-main');
    } else {
        $('#nav').addClass('above-main');
    }

});
});
