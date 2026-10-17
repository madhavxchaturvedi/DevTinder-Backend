const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const User = require("../models/User");
const { validateSignUpData } = require("../utils/validation");

const COOKIE_OPTIONS = {
  expires: new Date(Date.now() + 8 * 3600000),
  httpOnly: true,
  secure: true,
  sameSite: "none",
};

const setAuthCookie = (res, token) => {
  res.cookie("token", token, COOKIE_OPTIONS);
  res.cookie("auth_hint", "true", { ...COOKIE_OPTIONS, httpOnly: false });
};

const clearAuthCookie = (res) => {
  res.cookie("token", null, {
    expires: new Date(0),
    httpOnly: true,
    secure: true,
    sameSite: "none",
  });
  res.cookie("auth_hint", null, {
    ...COOKIE_OPTIONS,
    expires: new Date(0),
    httpOnly: false,
  });
};

router.post("/signup", async (req, res) => {
  try {
    //Validation of Data
    validateSignUpData(req);

    const { firstName, lastName, emailId, password } = req.body;

    //Encrypt the password
    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = new User({
      firstName,
      lastName,
      emailId,
      password: passwordHash,
    });
    const savedUser = await newUser.save();
    const token = await savedUser.getJWT();

    setAuthCookie(res, token);

    const userData = savedUser.toObject();
    delete userData.password;

    res.json({
      message: "User sign up SuccessFully!",
      data: userData,
      success: true,
    });
  } catch (err) {
    res.status(400).json({ message: err.message, success: false });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { emailId, password } = req.body;
    const user = await User.findOne({ emailId: emailId });
    if (!user) {
      throw new Error("Invalid Credentials");
    }

    const isPasswordValid = await user.validatePassword(password);
    if (isPasswordValid) {
      const token = await user.getJWT();

      setAuthCookie(res, token);

      const userData = user.toObject();
      delete userData.password;
      res.json({
        message: "Login Successful!",
        data: userData,
        success: true,
        ...userData,
      });
    } else {
      throw new Error("Invalid Credentials");
    }
  } catch (err) {
    res.status(400).json({ message: err.message, success: false });
  }
});

router.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ message: "LOGOUT Successfully!!", success: true });
});

router.setAuthCookie = setAuthCookie;
router.clearAuthCookie = clearAuthCookie;

module.exports = router;
module.exports.setAuthCookie = setAuthCookie;
module.exports.clearAuthCookie = clearAuthCookie;
