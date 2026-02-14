# QueueSense - Smart Queue Management System

QueueSense is a smart, offline-capable queue management system designed for small clinics and public offices. It uses `localStorage` for data persistence, making it perfect for demos and hackathons without needing a backend server.

## 🚀 Features

- **User Token Booking**: Simple interface for users to get a token.
- **Real-time Status**: Live updates on waiting time and queue position.
- **Admin Dashboard**: secure (PIN: `1234`) interface to manage the queue.
- **Public Display (TV Mode)**: High-contrast page for waiting room screens.
- **Smart Prediction**: Calculates estimated wait time based on actual service speed.

## 📂 Project Structure

- `index.html` - **Home Page**: Booking form and personal status tracking.
- `admin.html` - **Admin Panel**: For staff to call next token (Login PIN: `1234`).
- `live.html` - **TV Display**: Large screen view for the waiting area.
- `script.js` - **Core Logic**: Handles state management and wait time algorithms.
- `styles.css` - **Styling**: Global styles and animations.

## 🛠 How to Run

1.  Simply double-click `index.html` to open the App.
2.  Open `admin.html` in a new tab/window to control the queue.
3.  Open `live.html` in a third window (or second monitor) to simulate the public display.

## 📱 Usage Flow

1.  **Book a Token**: Go to Home, enter name, get a token.
2.  **Monitor**: See your estimated wait time.
3.  **Serve**: In Admin, click "Next Token" or log a service time (e.g., "10 minutes").
4.  **Updates**: Watch the estimates change dynamically on all screens!

## 🔐 Credentials

- **Admin PIN**: `1234`
