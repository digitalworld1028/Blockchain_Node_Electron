const ipc = require('electron').ipcRenderer;
var isTransaction = false;
$(document).ready(() => {
  var content = "";
  var indexArray = ["XLMUSD", "XRPUSD", "AUDJPY", "EURAUD", "EURJPY", "AUDCAD", "CADJPY", "CHFJPY", "EURCAD", "GBPCHF", "GBPJPY", "NZDJPY", "NZDUSD", "AUS200", "Bund", "Copper", "ESP35", "EUSTX50", "FRA40", "GER30", "HKG33", "JPN225", "NAS100", "NGAS", "SPX500", "SWE30", "UK100", "US2000", "US30", "VOLX", "XAGUSD", "XAUUSD", "AUDCHF", "AUDNZD", "AUDUSD", "AUDNZD", "CADCHF", "EURNZD", "EURCHF", "EURGBP", "GBPUSD", "GBPAUD", "GBPCAD", "EURNOK", "EURSEK", "EURUSD", "USDILS", "USDCAD", "USDCHF", "USDJPY", "USDMXN", "USDILS", "USDSEK", "USDZAR", "CHN50", "UKOil", "UKOilSpot", "USOil", "USOilSpot", "BTCUSD", "CORNF", "SOYF", "WHEATF", "EURTRY", "GBPNZD", "NZDCAD", "NZDCHF", "TRYJPY", "USDCNH", "USDHKD", "ZARJPY", "BCHUSD", "ETHUSD", "EOSUSD", "LTCUSD", "BIOTECH", "CANNABS", "CHN.ECOMM", "CHN.TECH", "ESPORTS", "FAANG", "USEquities", "EMBasket", "JPYBasket", "USDOLLAR", "CryptoMajor"];
  indexArray.sort();
  for($each = 0; $each < indexArray.length; $each++) {
    if($each == 0) content += `<option value="${indexArray[$each]}" selected>${indexArray[$each]}</option>`;
    else content += `<option value="${indexArray[$each]}">${indexArray[$each]}</option>`;
  }
  console.log(content);
  $('#type').html(content);
});
ipc.send('getData', {last_nonce: null});
ipc.on('getData_response', (event, arg) => {
  var tableContent = '';
  var returnData = arg.returnData;
  var ismore = arg.ismore;
  var last_nonce = null;
  if(returnData.length) {
    for (each of returnData) {
      last_nonce = each.nonce;
      tableContent += `<tr>
        <td style="width: 4%">${each.content.nonce}</td>
        <td style="width: 8%">${each.content.type}</td>
        <td style="width: 11%">${each.content.timestamp}</td>
        <td style="width: 6%">${each.content.action}</td>
        <td style="width: 9%">${each.content.entry_price}</td>
        <td style="width: 9%">${each.content.tp}</td>
        <td style="width: 9%">${each.content.sl}</td>
        <td style="width: 10%">${each.content.timeframe}</td>
        <td style="width: 10%">${each.content.tid}</td>
        <td style="width: 8%">${each.result}</td>
        <td style="width: 16%">${each.blockid}</td>`
    }
    if(ismore) tableContent += `<td colspan="20" id = "more"><a onclick="showMore(${last_nonce})">show more...</a></td></tr>`;
    else tableContent += `</tr>`;
    isTransaction = true;
  }
  else {
    tableContent += `<tr><td colspan="20" id="no-data">No transaction</td></tr>`;
    isTransaction = false;
  }
  $('.tbl-content tbody').html(tableContent);
});

function showMore(last_nonce) {
  ipc.send('getData', {last_nonce:last_nonce});
}

$('#new-button').click(function() {
  console.log('hello');
  $(".testbox").fadeIn();
});
$('#cancel-button').click(function() {
  $(".testbox").fadeOut();
  setTimeout(() => {
    $('#ep').val('');
    $('#timestamp').val('');
    $('#tp').val('');
    $('#sl').val('');
    $('#timeframe').val('');
    $('#tid').val('');
  }, 500);
})
$('#submit-button').click(function() {
  if (!$('#addData')[0].checkValidity()) {
    $('#addData')[0].reportValidity();
    return;
  }
  $action = $('#action').val();
  $type = $('#type').val();
  $entry_price = $('#ep').val();
  $timestamp = $('#timestamp').val();
  $tp = $('#tp').val();
  $sl = $('#sl').val();
  $timeframe = $('#timeframe').val();
  $tid = $('#tid').val();
  if($entry_price && $timestamp && $tp && $sl && $timeframe && $tid) {
    $(".testbox").fadeOut();
    setTimeout(() => {
      $('#ep').val('');
      $('#timestamp').val('');
      $('#tp').val('');
      $('#sl').val('');
      $('#timeframe').val('');
      $('#tid').val('');
    }, 500);
    var nonce = isTransaction ? $('.tbl-content tbody').children().length + 1 : 1
    $submit_transaction = {nonce: nonce, trans_type: 'exchange', action: $action, type: $type, entry_price: $entry_price, timestamp: $timestamp, tp: $tp, sl: $sl, timeframe: $timeframe, tid: $tid};
    var tableContent = $('.tbl-content tbody').html();
    tableContent = `<tr>
        <td style="width: 4%">${nonce}</td>
        <td style="width: 8%">${$type}</td>
        <td style="width: 11%">${$timestamp}</td>
        <td style="width: 6%">${$action}</td>
        <td style="width: 9%">${$entry_price}</td>
        <td style="width: 9%">${$tp}</td>
        <td style="width: 9%">${$sl}</td>
        <td style="width: 10%">${$timeframe}</td>
        <td style="width: 10%">${$tid}</td>
        <td style="width: 8%"></td>
        <td style="width: 16%"></td>
      </tr>` + (isTransaction ? tableContent : '');
    isTransaction = true;
    $('.tbl-content tbody').html(tableContent);
    console.log('submit transaction');
    ipc.send('submitTransaction', $submit_transaction);
  }
});
setInterval(() => {
  ipc.send('getTransactionState');
}, 100);
ipc.on('getTransactionState_response', (event, arg) => {
  console.log(arg);
  for(var each of arg) {
    var length = $('.tbl-content tbody').children('tr').length;
    console.log(each.nonce);
    for(var i = 0; i < length; i++){
      var eachTr = $('.tbl-content tbody').find(`tr:eq(${i})`);
      console.log($(eachTr).find('td:eq(0)').text());
      if($(eachTr).find('td:eq(0)').text() == each.nonce) {
        if(each.state) $(eachTr).find('td:eq(9)').text(each.state);
        if(each.blocknumber) $(eachTr).find('td:eq(10)').text(each.blocknumber);
        break;
      }
    };
  }
});