const express = require("express");
const router = express.Router();
const { userAuth } = require("../middlewares/auth");

router.post("/sendConnectionRequest", userAuth, (req, res) => {
  user = req.user;
  console.log("Sending connection request");

  res.send(user.firstName);
});

module.exports = router;
