const express = require("express");
const app = express();

app.use("/test", (req, res) => {
  res.send("hello world");
});

app.listen(8000, () => {
  console.log("server is sucessfully running on 8000");
});
