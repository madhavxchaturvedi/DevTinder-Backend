const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
  },
  emailId: {
    type: String,
    required: true,
    lowercase: true,
    unique: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minLength: 8,
  },
  age: {
    type: String,
    minmum: 16,
  },
  gender: {
    type: String,
    validate(value) {
      if (!["male", "female", "other"].includes(value)) {
        throw new Error("Gender data is not valid!");
      }
    },
  },
  photoUrl: {
    type: String,
    default: "https://geographyandyou.com/images/user-profile.png",
  },
  about: {
    type: String,
  },
  skills: {
    type: [String],
  },
},{
  timestamps:true,
});

const User = mongoose.model("User", userSchema);

module.exports = User;
