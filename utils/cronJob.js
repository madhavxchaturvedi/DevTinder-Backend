const cron = require("node-cron");
const ConnectionRequest = require("../models/connectionRequest");
const { subDays, startOfDay, endOfDay } = require("date-fns");
const sendEmail = require("./sendEmail");

cron.schedule("0 0 */14 * *", async () => {
  //send email to all users at 8 am every day who got requests in last 24 hours
  try {
    const yesterday = subDays(new Date(), 0);
    const yesterdayStart = startOfDay(yesterday);
    const yesterdayEnd = endOfDay(yesterday);

    const pendingRequests = await ConnectionRequest.find({
      status: "interested",
      createdAt: {
        $gte: yesterdayStart,
        $lte: yesterdayEnd,
      },
    }).populate("fromUserId toUserId");

    const listOfEmails = [
      ...new Set(pendingRequests.map((request) => request.toUserId.emailId)),
    ];

    for (email of listOfEmails) {
      try {
        const res = await sendEmail.run(
          "New Connection Requests" + email,
          "You have new connection requests on DevTinder. Please check your profile to see the details.",
        );
        console.log(`Email sent to ${email}:`, res);
      } catch (err) {
        console.error(`Error sending email to ${email}:`, err);
      }
    }
  } catch (err) {
    console.error(err);
  }
});
