const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  first_name: String,
  last_name: String,
  userID: String,
  public_key: String,
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Users', userSchema);