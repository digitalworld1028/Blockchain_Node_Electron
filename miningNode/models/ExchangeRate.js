const mongoose = require('mongoose');

const rateSchema = new mongoose.Schema({
  type: String,
  t: Number,
  o: Number,
  h: Number,
  l: Number,
  c: Number,
  v: Number
});

rateSchema.index({t: 1, type: 1});

module.exports = mongoose.model('ExchangeRate', rateSchema);