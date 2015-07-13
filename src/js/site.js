$(document).ready(function(){

  function setPanelHeight(){
    var windowHeight = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
    var windowWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    var navHeight = $('#nav').outerHeight();

    $('.panel').css('min-height', windowHeight - navHeight);
    $('#primary').css('min-height', windowHeight);

    var topMargin = ($('#primary').height() / 2) - $('h1').outerHeight();
    $('#title-box').css('marginTop', topMargin + 'px');

  }

  window.addEventListener('resize', setPanelHeight());

  cycleColors();
  setPanelHeight();

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
    stop = Math.round($(window).scrollTop());
    anchor = $('#anchor-point').offset().top;
    
    if (stop > anchor) {
        $('#nav').removeClass('above-main');
    } else {
        $('#nav').addClass('above-main');
    }

});
});
