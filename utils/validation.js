const validator = require("validator");

const validateSignUpData = (req) => {
  const { firstName, lastName, emailId, password } = req.body;
  if (!firstName) {
    throw new Error("Name is not valid!");
  } else if (!validator.isEmail(emailId)) {
    throw new Error("Email Address is not valid!");
  } else if (!validator.isStrongPassword(password)) {
    throw new Error("Please Enter a Strong Password!");
  }
};

const validateMyProfileEditData = (req) => {
  const allowedEditFields = [
    "firstName",
    "lastName",
    "photoUrl",
    "about",
    "gender",
    "age",
    "skills",
  ];

  const isEditAllowed = Object.keys(req.body).every((field) =>
    allowedEditFields.includes(field)
  );

  return isEditAllowed;
};

module.exports = { validateSignUpData, validateMyProfileEditData };
