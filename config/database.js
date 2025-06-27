const mongoose = require("mongoose");

const connectDB = async () => {
  await mongoose.connect(
    "mongodb+srv://madhavchaturvedi0562:ulAszCiHO7PcsqwS@cluster0.124qkfc.mongodb.net/devTinder?retryWrites=true&w=majority&appName=Cluster0"
  );
};

module.exports = connectDB;
