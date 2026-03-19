const express = require("express");
const router = express.Router();

const { userAuth } = require("../middlewares/auth");
const razorpayInstance = require("../utils/razorpay");
const Payment = require("../models/Payment");
const { membershipAmount } = require("../utils/constant");
const {
  validateWebhookSignature,
} = require("razorpay/dist/utils/razorpay-utils");
const User = require("../models/User");

router.post("/payment/create", userAuth, async (req, res) => {
  try {
    const { membershipType } = req.body;
    const { firstName, lastName, emailId } = req.user;

    const order = await razorpayInstance.orders.create({
      amount: membershipAmount[membershipType] * 100, // amount in paise
      currency: "INR",
      receipt: "receipt#1",
      notes: {
        firstName,
        lastName,
        emailId,
        membershipType: membershipType,
      },
    });

    const payment = new Payment({
      userId: req.user._id,
      orderId: order.id,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      notes: order.notes,
    });

    //save it in DB
    const savedPayment = await payment.save();

    // console.log("Order Created: ", order);

    res.json({
      message: "Order Created Successfully",
      ...savedPayment.toJSON(),
      keyId: process.env.RAZORPAY_KEY_ID, // Send the Razorpay key_id to the frontend
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

router.post("/payment/webhook", async (req, res) => {
  try {
    const webhookSignature = req.get("X-Razorpay-Signature");
    const isWebhookValid = validateWebhookSignature(
      JSON.stringify(req.body),
      webhookSignature,
      process.env.RAZORPAY_WEBHOOK_SECRET,
    );

    if (!isWebhookValid) {
      return res.status(400).json({ message: "Invalid webhook signature" });
    }

    //update the payment status in DB
    const paymentDetails = req.body.payload.payment.entity;
    const payment = await Payment.findOne({ orderId: paymentDetails.order_id });
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }
    payment.status = paymentDetails.status;
    await payment.save();

    //update the user membership status in DB
    const user = await User.findOne({ _id: payment.userId });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    user.isPremium = true;
    user.membershipType = payment.notes.membershipType;

    await user.save();

    res
      .status(200)
      .json({ message: "Webhook received and processed successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
