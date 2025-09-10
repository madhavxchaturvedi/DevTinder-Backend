# DevTinder – Backend  

This is the backend of **DevTinder**, a Tinder-like platform built for developers to connect, collaborate, and grow. The backend is developed with **Node.js, Express.js, and MongoDB**, providing a scalable and secure API for the frontend.  

---

## 🚀 Features  
- 👤 **User Authentication** – JWT-based signup and login  
- 🤝 **Connection Requests** – Send, accept, and reject requests  
- 💬 **Real-time Messaging** – Powered by Socket.io  
- 💳 **Razorpay Payment Integration** – Premium features  
- 📝 **Profile Management** – Update user details securely  
- 📧 **Email Integration (AWS SES)** – For verification and notifications  
- ☁️ **Deployed on AWS** – Production-ready backend services  

---

## 🛠️ Tech Stack  
- **Server:** Node.js, Express.js  
- **Database:** MongoDB, Mongoose  
- **Authentication:** JWT, bcrypt  
- **Real-time:** Socket.io  
- **Payments:** Razorpay API  
- **Email Service:** AWS SES  
- **Deployment:** AWS  

---

## 📂 Folder Structure  
```bash
devtinder-backend/
│── src/
│   ├── config/       # DB & server configs  
│   ├── controllers/  # Route controllers  
│   ├── middleware/   # Auth & validation middleware  
│   ├── models/       # Mongoose schemas  
│   ├── routes/       # API routes  
│   └── server.js     # Main entry point  
│
└── .env              # Environment variables
```
## ⚡ Getting Started  
Follow these steps to run the backend locally:  

### 1. Clone the repo  
```bash
git clone https://github.com/your-username/devtinder-backend.git
cd devtinder-backend
```
### 2. Install dependencies
```base
npm install
```

### 3. Set up environment variables

Create a .env file in the root directory and add:

```base
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
RAZORPAY_KEY_ID=your_razorpay_key
RAZORPAY_KEY_SECRET=your_razorpay_secret
AWS_ACCESS_KEY=your_aws_access_key
AWS_SECRET_KEY=your_aws_secret_key
AWS_REGION=your_aws_region
```
### 4. Run the server
```base
npm start
```

## API Endpoints  

### 🔑 Authentication  
- `POST /api/auth/register` – Register new user  
- `POST /api/auth/login` – User login  

### 🤝 Connection Requests  
- `POST /api/requests/send/:id` – Send connection request  
- `POST /api/requests/accept/:id` – Accept connection request  
- `POST /api/requests/reject/:id` – Reject connection request  

### 💬 Messaging  
- `GET /api/messages/:id` – Get messages with a user  
- `POST /api/messages/:id` – Send message  
