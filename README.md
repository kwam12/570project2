# Retail Loyalty Program and Customer Behavior Analysis

## Description

This project develops a hybrid system to manage loyalty programs and analyze customer behavior. SQL handles structured data like transaction histories and loyalty points, while NoSQL analyzes shopping patterns and feedback. The system generates personalized promotions based on user preferences to improve customer retention and sales. It integrates front-end tools for customers to track rewards and offers.

## Key Features

*   **SQL:** Transaction history, loyalty points, and product catalog data are structured and managed effectively with SQL databases. This ensures accurate tracking of purchases and rewards.
*   **NoSQL:** Customer feedback, preferences, and shopping patterns are unstructured and benefit from NoSQL for dynamic storage and analysis. This enables targeted promotions and personalized marketing campaigns.
*   **Front-end:** The user interface should allow customers to track rewards, view personalized offers, and manage their loyalty accounts. A sleek design fosters customer retention.
*   **Back-end:** The backend integrates purchase data with behavioral insights to generate personalized promotions, improving customer engagement and sales outcomes. 

## Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

*   Node.js (version 20.0.0 or higher recommended, as per `package.json`)
*   npm (usually comes with Node.js)
*   MySQL Server (Ensure it's installed and running)
*   MongoDB Server (Ensure it's installed and running)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd <your-project-directory>
    ```
    *(Replace `<your-repository-url>` and `<your-project-directory>` with actual values)*

2.  **Install dependencies:**
    ```bash
    npm install
    ```

### Configuration

1.  **Create Environment File:**
    *   In the root of the project, create a file named `.env`.
    *   Copy the contents from `.env.example` (which will be created in the next step if it doesn't exist) or add the following variables, customizing them for your local environment. **Do not commit your actual `.env` file with sensitive credentials to Git.**

    ```env
    PORT=3001
    JWT_SECRET=your-very-strong-and-unique-secret-key-here
    STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key_here 
    STRIPE_WEBHOOK_SECRET=whsec_your_stripe_webhook_secret_here

    # MongoDB Connection
    MONGO_URI=mongodb://localhost:27017/yourProjectDB_NoSQL

    # MySQL Connection
    MYSQL_DB_NAME=yourProjectDB_SQL
    MYSQL_DB_USER=your_mysql_user
    MYSQL_DB_PASSWORD=your_mysql_password
    MYSQL_DB_HOST=localhost
    MYSQL_DB_PORT=3306
    ```
    *(Make sure to replace placeholder values like `your-very-strong-and-unique-secret-key-here`, `sk_test_your_stripe_secret_key_here`, database names, user, and password with your actual development settings.)*

2.  **Database Setup:**
    *   Ensure your MySQL and MongoDB servers are running.
    *   Create the databases in MySQL and MongoDB that you specified in your `.env` file (e.g., `yourProjectDB_SQL` and `yourProjectDB_NoSQL`).
    *   The application uses Sequelize's `sync({ alter: true })` feature (found in `server.js`), which will attempt to create or update tables in your SQL database to match the defined models when the backend server starts.
    *   The `server.js` also includes a `seedDatabase()` function that will populate initial product and promotion data into the SQL database if the tables are detected as empty.

### Running the Application

1.  **Start the Backend Server:**
    *   Open a terminal in the project root and run:
        ```bash
        npm run server
        ```
    *   Look for console output confirming successful connections to MongoDB and MySQL, and messages related to database syncing and seeding (e.g., "MongoDB Connected", "MySQL Connection has been established successfully.", "Sequelize models synced successfully.", "SQL Database seeded...").

2.  **Start the Frontend Development Server:**
    *   Open a new terminal in the project root and run:
        ```bash
        npm run dev
        ```
    *   This will typically open the application in your default web browser (often at `http://localhost:5173` or a similar address provided by Vite). 