const express = require("express");
const { userAuth } = require("../middlewares/auth");
const ConnectionRequestModel = require("../models/connectionRequest");
const router = express.Router();

const userAllowedData = [
  "firstName",
  "lastName",
  "photoUrl",
  "skills",
  "age",
  "about",
  "gender",
];

router.get("/user/request/received", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;

    const connectionRequest = await ConnectionRequestModel.find({
      toUserId: loggedInUser._id,
      status: "interested",
    }).populate("fromUserId", userAllowedData);

    res.json({ message: "Data Fetched Successfully", data: connectionRequest });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});


module.exports = router;
