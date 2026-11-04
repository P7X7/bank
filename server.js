
const express = require("express");
const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Bank server is running!");
});

app.post("/sms", (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({
      success: false,
      error: "Invalid message"
    });
  }

  // لا نحفظ رسائل البنك أو رموز التحقق
  if (/رمز التحقق|OTP|verification code/i.test(message)) {
    return res.json({
      success: true,
      ignored: true
    });
  }

  console.log("Bank SMS received");

  res.json({
    success: true,
    received: true
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
