(function($) {
  /**
   * Add Class in header when scroll
   */
  function checkScroll()
  {
    var scroll = $(window).scrollTop();
    if (scroll >= 108) {
      $('body').addClass('scrolled');
    } else {
      $('body').removeClass('scrolled');
    }
  }
  $(window).scroll(function() {
    checkScroll();
  });
  checkScroll();

  /**
   * Carousel indicators
   */
	if($(".carousel").length)
	{
		let myCarousels = $(".carousel");
		myCarousels.each(function(index, element){
	    let myCarousel = $("#"+$(element).attr('id'));
	    myCarousel.append('<div class="carousel-indicators"></div>');
	    let indicators = $('#'+$(element).attr("id") + ' .carousel-indicators');
	    $('#'+$(element).attr("id") +' .carousel-inner').children('.carousel-item').each(function(index) {
	        (index === 0) ?
	        indicators.append('<button type="button" data-bs-target="#'+$(element).attr('id')+'" data-bs-slide-to="'+index+'" class="active">') :
	        indicators.append('<button type="button" data-bs-target="#'+$(element).attr('id')+'" data-bs-slide-to="'+index+'">');
	    });
		});
	}

  /*
   * Phone Mask
   */
  var SPMaskBehavior = function (val) {
    return val.replace(/\D/g, '').length === 11 ? '(00) 00000-0000' : '(00) 0000-00009';
  },
  spOptions = {
    onKeyPress: function(val, e, field, options) {
        field.mask(SPMaskBehavior.apply({}, arguments), options);
      }
  };
  $('.telefone input').mask(SPMaskBehavior, spOptions);
  $('.cpf input').mask('999.999.999-99');

  /*
   * Select local
   */
  $(document).on('change','#local', function()
  {
    let url = $(this).data('url');
    let local = $(this).val();
    console.log(local);

    if(local)
    {
      window.location.replace(url+local);
    }
  });

  /*
   * Count down
   */
  function countDown() {
    if ($('.countdown').length > 0) {
      const target = $(".countdown").data('target');
      const days = $(".countdown #days .digit");
      const hours = $(".countdown #hours .digit");
      const minutes = $(".countdown #minutes .digit");
      const seconds = $(".countdown #seconds .digit");

      const targetDate = new Date(target).getTime(); // Convertendo para timestamp

      function convertMillis(milliseconds) {
        let total_seconds = Math.floor(milliseconds / 1000);
        let total_minutes = Math.floor(total_seconds / 60);
        let total_hours = Math.floor(total_minutes / 60);
        let days = Math.floor(total_hours / 24);

        let seconds = total_seconds % 60;
        let minutes = total_minutes % 60;
        let hours = total_hours % 24;

        return { d: days, h: hours, m: minutes, s: seconds };
      }

      const interval = setInterval(function () {
        const now = Date.now(); // Atualiza o timestamp atual
        const millis = targetDate - now;

        if (millis <= 0) {
          clearInterval(interval);
          days.text("00");
          hours.text("00");
          minutes.text("00");
          seconds.text("00");
        } else {
          const millisObject = convertMillis(millis);
          days.text(millisObject.d.toString().padStart(2, '0'));
          hours.text(millisObject.h.toString().padStart(2, '0'));
          minutes.text(millisObject.m.toString().padStart(2, '0'));
          seconds.text(millisObject.s.toString().padStart(2, '0'));
        }
      }, 1000);
    }
  }
  countDown();


  var wpcf7Elm = document.querySelector( '#wpcf7-f30451-o1' );
  if (wpcf7Elm !== null)
  {
    wpcf7Elm.addEventListener( 'wpcf7mailsent', function(event)
    {
      $(this).hide();
      $('.pagename-patrocinio .col-b .success').removeClass('d-none');
    }, false );
  }

  $('#select-locations').on('change', function()
  {
    var $option = $(this).find('option:selected');
    var value = $option.val();
    var text = $option.text();
    $('#location-search').val(text);
    $('#location-form .btn').trigger('click');
    $('#location-search').val(text);

    $('html, body').animate({
      scrollTop: $('#map').offset().top
    });
  });

  /**
   * Dynamic modal content
   */
  $(document).ready(function() {
    $(document).on('show.bs.modal', '#defaultModal', function(event) {
      const button = $(event.relatedTarget);
      const sponsorId = button.data('id');
      const sponsorContent = $('#' + sponsorId).html();
      $(this).find('.modal-body').html(sponsorContent);
    });
  });

})(jQuery);