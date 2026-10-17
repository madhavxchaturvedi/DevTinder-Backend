const jwt = require("jsonwebtoken");
const User = require("../models/User");

const userAuth = async (req, res, next) => {
  try {
    const { token } = req.cookies;
    if (!token) {
      // throw new Error("Token is not valid!");
      return res.status(401).json({ message: "Please Login!", success: false });
    }

    const decodedData = await jwt.verify(token, process.env.JWT_SECRET_KEY);

    const { _id } = decodedData;

    const user = await User.findById(_id);

    if (!user) {
      throw new Error("User does not exist!");
    }

    req.user = user;

    next();
  } catch (err) {
    res.status(400).json({ message: err.message, success: false });
  }
};

module.exports = { userAuth };
