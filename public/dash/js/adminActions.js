$(document).ready(function() {
	const container = document.querySelector('.chat-scroll');
	if(container) container.scrollTop = 99999;
	$(document).on('click', '.socketStart', function() {
		$.ajax({
            url: '/admin/socket/start',
            type: 'POST',
            success: function(data) {
				$.notify({
					type: data.type,
					message: data.msg
				});
            }
        });
	});
	$(document).on('click', '.socketStop', function() {
		$.ajax({
            url: '/admin/socket/stop',
            type: 'POST',
            success: function(data) {
				$.notify({
					type: data.type,
					message: data.msg
				});
            }
        });
	});
    // socket.io admin realtime feed disabled in Next.js migration
	function sendMessage() {
        var message = $('#chatmess').val();
        var user_id = $('#users').val();
        $.ajax({
            url: '/admin/chatSend',
            type: 'POST',
            data: {
                type: 'push',
				user_id: user_id,
                message: message
            },
            success: function(data) {
				$('#chatmess').val('');
				$.notify({
					type: data.status,
					message: data.message
				});
				return;
            }
        });
    }
	$('#chatmess').keypress(function(e) {
        if (e.keyCode == 13) {
            sendMessage();
            return false;
        }
    });
    $('#chatsend').click(function() {
        sendMessage();
        return false;
    });
	$(document).on('click', '.clearChat', function() {
		$.ajax({
            url : '/admin/clear',
            type : 'post',
            success : function(data) {
				$.notify({
					type: data.type,
					message: data.msg
				});
				return false;
            },
            error : function(data) {
                console.log(data.responseText);
            }
        });
	});
    $('#url').keyup(function() {
        var url = $('#url').val();
        console.log($('#url').val());
        $.ajax({
            type: 'post',
            url: '/admin/getVKUser',
            data: {url: url},
            success: function(data){
                if(url) {
                    $('#prof').show();
                    $('#name').val(data[0].first_name+' '+data[0].last_name);
                    $('#vkId').val(data[0].id);
                    $('#ava').attr("src", data[0].photo_max);
                    $('#avatar').val(data[0].photo_max);
                } else {
                    $('#prof').hide();
                }
            }
        });
    });
    $(document).on('keyup', '.bgColor', function() {
		var bg = $(this).val();
		$(this).parent().parent().find('.exBg').css({background: bg});
    });
    $(document).on('keyup', '.textColor', function() {
		var color = $(this).val();
		$(this).parent().parent().find('.exText').css({color: color});
    });
	$('.betJackpot').on('click', function() {
		var user = $('#users_jackpot').val();
		var sum = $('#sum_jackpot').val();
		var room = $('#room_jackpot').val();
		var balance = $('#balance_jackpot').val();
		$.ajax({
			url: '/admin/betJackpot',
			type: "POST",
			data: {
				user: user,
				amount: parseFloat(sum),
				room: room,
				balance: balance
			},
			success: function(data) {
                $.notify({
					type: (data.success ? 'success' : 'error'),
					message: data.msg
				});
				return;
			}
		});
	});
	$('.gotWheel').on('click', function() {
		var color = $(this).data('color');
		$.ajax({
			url: '/admin/gotWheel',
			type: "POST",
			data: {
				color: color
			},
			success: function(data) {
                $.notify({
					type: data.type,
					message: data.msg
				});
				return;
			}
		});
	});
	$('.betWheel').on('click', function() {
		var user = $('#users_wheel').val();
		var sum = $('#sum_wheel').val();
		var color = $('#color_wheel').val();
		var balance = $('#balance_wheel').val();
		$.ajax({
			url: '/admin/betWheel',
			type: "POST",
			data: {
				user: user,
				sum: sum,
				color: color,
				balance: balance
			},
			success: function(data) {
                $.notify({
					type: data.type,
					message: data.msg
				});
				return;
			}
		});
	});
	$('.gotCrash').on('click', function() {
		var multiplier = $('#multiplier_crash').val();
		$.ajax({
			url: '/admin/gotCrash',
			type: "POST",
			data: {
				multiplier: multiplier
			},
			success: function(data) {
                $.notify({
					type: data.type,
					message: data.msg
				});
				return;
			}
		});
	});
	$('.betDice').on('click', function() {
		var user = $('#users_dice').val();
		var sum = $('#sum_dice').val();
		var perc = $('#chance_dice').val();
		var balance = $('#balance_dice').val();
		$.ajax({
			url: '/admin/betDice',
			type: "POST",
			data: {
				user: user,
				sum: sum,
				perc: perc,
				balance: balance
			},
			success: function(data) {
                $.notify({
					type: data.type,
					message: data.msg
				});
				return;
			}
		});
	});
	$('.gotBattle').on('click', function() {
		var color = $(this).data('color');
		$.ajax({
			url: '/admin/gotBattle',
			type: "POST",
			data: {
				color: color
			},
			success: function(data) {
                $.notify({
					type: data.type,
					message: data.msg
				});
				return;
			}
		});
	});
	$('.betBattle').on('click', function() {
		var user = $('#users_battle').val();
		var sum = $('#sum_battle').val();
		var color = $('#color_battle').val();
		var balance = $('#balance_dice').val();
		$.ajax({
			url: '/admin/betBattle',
			type: "POST",
			data: {
				user: user,
				sum: sum,
				color: color,
				balance: balance
			},
			success: function(data) {
                $.notify({
					type: data.type,
					message: data.msg
				});
				return;
			}
		});
	});
});
function gotRoulette(game_id, user_id) {
    $.ajax({
        url: '/admin/gotJackpot',
        type: 'POST',
        data: {
            type: 'push',
            game_id: game_id,
            user_id: user_id
        },
        success: function(data) {
			$.notify({
				type: data.type,
				message: data.msg
			});
            return;
        }
    });
}
function chatdelet(id) {
	$.post('/admin/chatdel', {messages: id}, function (data) {
		if (data) {
			$.notify({
				type: data.status,
				message: data.message
			});
		}
	});
}
