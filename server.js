import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose'; // Import mongoose
import bcrypt from 'bcryptjs'; // Import bcryptjs
import jwt from 'jsonwebtoken'; // Import jsonwebtoken
import { Sequelize } from 'sequelize';
import { DataTypes } from 'sequelize'; // Import DataTypes
import stripePackage from 'stripe';

// --- JWT Secret ---
// IMPORTANT: Store this securely in environment variables for production!
const JWT_SECRET = process.env.JWT_SECRET || 'your-very-strong-secret-key'; 

// --- Stripe Initialization ---
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error('*** Stripe Secret Key is missing. Please set STRIPE_SECRET_KEY in your .env file ***');
  // process.exit(1); // Optionally exit if key is missing
}
const stripe = stripePackage(STRIPE_SECRET_KEY);
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
// --- End Stripe Initialization ---

// --- Authentication Middleware ---
const authMiddleware = async (req, res, next) => { // Made async
  // Get token from header
  const authHeader = req.header('Authorization');

  // Check if not token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const token = authHeader.split(' ')[1]; // Extract token after "Bearer "
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Decoded ID is now the SQL User ID
    const sqlUserId = decoded.user.id;
    
    // Fetch the SQL user from the database
    const sqlUser = await SqlUser.findByPk(sqlUserId, {
        attributes: { exclude: ['password'] } // Exclude password hash
    }); 

    if (!sqlUser) {
        console.warn(`[Auth Middleware] SQL User not found for ID in token: ${sqlUserId}`);
        return res.status(401).json({ message: 'Token is not valid (user not found)' });
    }

    // Attach SQL user object to request object
    req.sqlUser = sqlUser; 
    
    // --- Keep Mongo User ID available for now --- 
    // (Needed by wishlist, feedback endpoints until fully refactored)
    // Find the corresponding Mongo User ID using the email from the SQL user
    // In a fully refactored system, we might remove this lookup.
    const mongoUser = await User.findOne({ email: sqlUser.email }).select('_id');
    if (mongoUser) {
        req.user = { id: mongoUser._id.toString() }; // Keep req.user structure for compatibility
    } else {
        // Handle case where Mongo user might be missing (optional, depends on desired robustness)
        console.warn(`[Auth Middleware] Could not find corresponding Mongo user for SQL user: ${sqlUser.email}`);
        // Decide how to handle: proceed without req.user, or deny access?
        // For now, let's allow proceeding but log the warning.
        req.user = null; // Or keep it undefined
    }
    // --- End Mongo User ID --- 

    next(); // Proceed to the next middleware or route handler
  } catch (err) {
    console.error('Token verification or User lookup failed:', err.message);
    res.status(401).json({ message: 'Token is not valid' });
  }
};
// --- End Authentication Middleware ---

// --- MongoDB Connection ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/nourDB';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// --- Sequelize (MySQL) Connection ---
const sequelize = new Sequelize(
  process.env.MYSQL_DB_NAME || 'nourDB_sql', // Fallback DB name
  process.env.MYSQL_DB_USER || 'root',      // Fallback user
  process.env.MYSQL_DB_PASSWORD || 'Password123!', // Added fallback password
  {
    host: process.env.MYSQL_DB_HOST || 'localhost', // Reverted back from '127.0.0.1'
    port: process.env.MYSQL_DB_PORT || 3306,
    dialect: 'mysql',
    logging: console.log, // Log SQL queries (can be false for production)
  }
);

// Test the connection
sequelize.authenticate()
  .then(() => console.log('MySQL Connection has been established successfully.'))
  .catch(err => console.error('Unable to connect to the MySQL database:', err));

// Sync Sequelize models with the database
// Use { alter: true } carefully in production, migrations are safer
sequelize.sync({ alter: true })
  .then(() => console.log('Sequelize models synced successfully.'))
  .catch(err => console.error('Error syncing Sequelize models:', err));

// --- MongoDB Schemas ---

// Existing Product Schema (ensure it's defined)
const ProductSchema = new mongoose.Schema({
    name: String,
    price: Number,
    originalPrice: Number,
    category: String,
    image: String,
    colors: [String],
    sizes: [String],
    description: String,
    brand: String,
    isNew: Boolean,
    isBestSeller: Boolean,
    matchingSet: Boolean,
    wishlistCount: { type: Number, default: 0, index: true }, // <-- Added for popularity tracking
    // Add other fields as needed
});
const Product = mongoose.model('Product', ProductSchema);


// User Schema - Add loyaltyPoints
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    username: { type: String, required: true, unique: true, lowercase: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    loyaltyPoints: { type: Number, default: 0 }, // <-- Added Loyalty Points
    createdAt: { type: Date, default: Date.now }
});

// Method to compare password for login
UserSchema.methods.comparePassword = function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};
const User = mongoose.model('User', UserSchema);


// // New Order Item Schema (Subdocument) - MOVED TO SQL
// const OrderItemSchema = new mongoose.Schema({
//     product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
//     name: { type: String, required: true }, // Store name at time of order
//     quantity: { type: Number, required: true, min: 1 },
//     price: { type: Number, required: true } // Store price at time of order
// }, { _id: false }); // Prevent Mongoose from creating _id for subdocuments


// // New Order Schema - MOVED TO SQL
// const OrderSchema = new mongoose.Schema({
//     user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
//     items: [OrderItemSchema], // Array of order items
//     subTotal: { type: Number, required: true }, // Add subTotal before discount
//     appliedPromoCode: { type: String, default: null },
//     discountAmount: { type: Number, default: 0 },
//     totalAmount: { type: Number, required: true }, // Final amount after discount
//     orderDate: { type: Date, default: Date.now },
//     status: { type: String, default: 'Completed', enum: ['Pending', 'Completed', 'Shipped', 'Cancelled'] }, // Example statuses
//     shippingAddress: {
//         fullName: String,
//         streetAddress: String,
//         city: String,
//         state: String,
//         postalCode: String,
//         country: String
//     },
//     stripeSessionId: { type: String, unique: true, sparse: true, index: true }, // Added for idempotency
//     // paymentMethod: String,
//     // paymentResult: { id: String, status: String, ... }
// });
// const Order = mongoose.model('Order', OrderSchema); // Create the Order model

// New Feedback Schema
const FeedbackSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, // Optional: Link feedback to a specific product
    rating: { type: Number, min: 1, max: 5 }, // Optional: Star rating
    comment: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', FeedbackSchema);

// // New Promotion Schema - MOVED TO SQL
// const PromotionSchema = new mongoose.Schema({
//     code: { type: String, required: true, unique: true, uppercase: true, trim: true },
//     description: { type: String, required: true },
//     discountType: { type: String, required: true, enum: ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING'] },
//     discountValue: { type: Number, required: true, default: 0 },
//     isActive: { type: Boolean, default: true, index: true },
//     applicableTier: { type: String, enum: [null, 'Bronze', 'Silver', 'Gold'], default: null }, // null means general
//     minSpend: { type: Number, default: 0 },
//     maxUses: { type: Number, default: null }, // null = unlimited
//     maxUsesPerUser: { type: Number, default: 1 },
//     startDate: { type: Date },
//     endDate: { type: Date },
//     usageCount: { type: Number, default: 0 } // Track total uses
// }, { timestamps: true }); // Add createdAt/updatedAt automatically
// const Promotion = mongoose.model('Promotion', PromotionSchema);

// --- End MongoDB Schemas ---

// --- Sequelize Models ---

const SqlUser = sequelize.define('User', {
  // Model attributes are defined here
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    // unique: true // REMOVED unique constraint to avoid "Too many keys" error on sync
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true, // Assuming email should be unique in SQL too
    validate: {
      isEmail: true
    }
  },
  password: { // Added password field for storing hash
    type: DataTypes.STRING,
    allowNull: false 
  },
  loyaltyPoints: { // Added loyalty points
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  // We generally DON'T store the plain or hashed password directly in SQL 
  // if JWT is handled by the Node server using the Mongo user record.
  // If SQL needs separate auth, we'd add a password hash field here.
  
  // Optional: Store MongoDB ObjectId for reference?
  mongoUserId: {
    type: DataTypes.STRING,
    allowNull: true // Or false if always required
  }
}, {
  // Other model options go here
  tableName: 'users' // Explicitly set table name
});

// --- New Sequelize Product Model ---
const SqlProduct = sequelize.define('Product', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  price: {
    type: DataTypes.DECIMAL(10, 2), // Use DECIMAL for currency
    allowNull: false
  },
  originalPrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true
  },
  category: {
    type: DataTypes.STRING,
    allowNull: true // Or false if always required
  },
  image: {
    type: DataTypes.STRING,
    allowNull: true
  },
  colors: {
    type: DataTypes.JSON, // Store array as JSON
    allowNull: true
  },
  sizes: {
    type: DataTypes.JSON, // Store array as JSON
    allowNull: true
  },
  description: {
    type: DataTypes.TEXT, // Use TEXT for potentially longer descriptions
    allowNull: true
  },
  brand: {
    type: DataTypes.STRING,
    allowNull: true
  },
  isNew: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  isBestSeller: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  matchingSet: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  wishlistCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  }
  // Sequelize automatically adds createdAt and updatedAt
}, {
  tableName: 'products'
});

// --- New Sequelize Order Model ---
const SqlOrder = sequelize.define('Order', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    userId: { // Foreign key to SqlUser
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: SqlUser, key: 'id' }
    },
    subTotal: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    appliedPromoCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    discountAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    totalAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    orderDate: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Completed', // Or 'Pending' before fulfillment
        allowNull: false
    },
    // Shipping Address fields
    shippingFullName: { type: DataTypes.STRING },
    shippingStreetAddress: { type: DataTypes.STRING },
    shippingCity: { type: DataTypes.STRING },
    shippingState: { type: DataTypes.STRING },
    shippingPostalCode: { type: DataTypes.STRING },
    shippingCountry: { type: DataTypes.STRING },
    // Stripe Session ID for idempotency
    stripeSessionId: {
        type: DataTypes.STRING,
        unique: true, 
        allowNull: true // Allow null initially if order created pre-payment
    }
    // Sequelize automatically adds createdAt and updatedAt
}, {
    tableName: 'orders'
});

// --- New Sequelize OrderItem Model ---
const SqlOrderItem = sequelize.define('OrderItem', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    orderId: { // Foreign key to SqlOrder
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: SqlOrder, key: 'id' }
    },
    productId: { // Foreign key to SqlProduct
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: SqlProduct, key: 'id' }
    },
    name: { // Store name at time of order
        type: DataTypes.STRING,
        allowNull: false
    },
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 }
    },
    price: { // Store price at time of order
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    }
    // Sequelize automatically adds createdAt and updatedAt
}, {
    tableName: 'order_items',
    timestamps: false // Often not needed on item level if order has timestamps
});

// --- Define Associations ---
SqlOrder.hasMany(SqlOrderItem, { foreignKey: 'orderId', as: 'items' });
SqlOrderItem.belongsTo(SqlOrder, { foreignKey: 'orderId' });

SqlOrderItem.belongsTo(SqlProduct, { foreignKey: 'productId' });
SqlProduct.hasMany(SqlOrderItem, { foreignKey: 'productId' }); // Optional reverse association

SqlOrder.belongsTo(SqlUser, { foreignKey: 'userId' }); // User association
SqlUser.hasMany(SqlOrder, { foreignKey: 'userId' }); // Optional reverse association

// --- New Sequelize Promotion Model ---
const SqlPromotion = sequelize.define('Promotion', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    code: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        // Consider adding validation for uppercase/trim if needed at DB level
    },
    description: {
        type: DataTypes.STRING,
        allowNull: false
    },
    discountType: {
        type: DataTypes.ENUM('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING'),
        allowNull: false
    },
    discountValue: {
        type: DataTypes.DECIMAL(10, 2), // Use DECIMAL for amounts
        allowNull: false,
        defaultValue: 0
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        // Indexing isActive is good for filtering active promotions
        // Sequelize might add it automatically depending on usage, or add manually:
        // index: true 
    },
    applicableTier: {
        type: DataTypes.ENUM('Bronze', 'Silver', 'Gold'), // Null represents general
        allowNull: true, 
        defaultValue: null
    },
    minSpend: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    maxUses: {
        type: DataTypes.INTEGER,
        allowNull: true // null = unlimited
    },
    maxUsesPerUser: {
        type: DataTypes.INTEGER,
        allowNull: true, // null = unlimited per user (or use 1 as default if applicable)
        defaultValue: 1 
    },
    startDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    endDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    usageCount: { 
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0 
    }
    // Sequelize automatically adds createdAt and updatedAt
}, {
    tableName: 'promotions',
    // Add index manually if needed
    indexes: [
        { fields: ['isActive'] },
        { fields: ['code'] }
    ]
});

// --- New Personalized Code Usage Model ---
const PersonalizedCodeUsage = sequelize.define('PersonalizedCodeUsage', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    userId: { // Foreign key to SqlUser
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: SqlUser, key: 'id' }
    },
    code: {
        type: DataTypes.STRING,
        allowNull: false,
        // Indexing code might be useful depending on query patterns
    },
    usedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    }
}, {
    tableName: 'personalized_code_usage',
    updatedAt: false, // Only need createdAt (which Sequelize adds by default if timestamps: true)
    createdAt: 'usedAt' // Rename default createdAt to usedAt
    // Or keep timestamps: true and just use the default createdAt
});

// Define association
PersonalizedCodeUsage.belongsTo(SqlUser, { foreignKey: 'userId' });
SqlUser.hasMany(PersonalizedCodeUsage, { foreignKey: 'userId' }); // Optional reverse association

// --- End Sequelize Models ---

// --- Helper to add initial data (optional) ---
async function seedDatabase() {
    try {
        // Seed Products into MySQL if table is empty
        const productCountSql = await SqlProduct.count();
        if (productCountSql === 0) {
            console.log('No products found in SQL, seeding database...');
            const initialProducts = [
              // Shoes (Using numeric sizes)
              { name: "Stylish Shoe 1", price: 79.95, image: "/assets/shoes/nm_4950959_100491_m.jpeg", category: "shoes", colors: ["#FFFFFF", "#000000", "#F5F5DC"], sizes: ["6", "7", "8", "9"], isNew: true },
              { name: "Comfortable Shoe 2", price: 89.95, image: "/assets/shoes/nm_4859632_100244_m.jpeg", category: "shoes", colors: ["#A0522D", "#F5F5DC"], sizes: ["7", "8", "9", "10", "11"], isBestSeller: true },
              { name: "Classic Shoe 3", price: 119.95, image: "/assets/shoes/nm_4837164_100212_m.jpeg", category: "shoes", colors: ["#8B4513"], sizes: ["8", "9", "10"] },
              { name: "Elegant Shoe 4", price: 99.00, originalPrice: 140.00, image: "/assets/shoes/nm_4837164_100106_m.jpeg", category: "shoes", colors: ["#000000", "#FFC0CB"], sizes: ["5", "6", "7", "8"] },
              { name: "Stylish Shoe 5", price: 69.95, image: "/assets/shoes/nm_4820370_100339_m.jpeg", category: "shoes", colors: ["#FFFFFF", "#000000"], sizes: ["6", "7", "8", "9", "10"], isNew: true },
              { name: "Comfortable Shoe 6", price: 95.50, image: "/assets/shoes/nm_4820370_100147_m.jpeg", category: "shoes", colors: ["#A0522D"], sizes: ["7", "8", "9"] },
              { name: "Classic Shoe 7", price: 129.00, image: "/assets/shoes/nm_4816957_100106_m.jpeg", category: "shoes", colors: ["#8B4513", "#F5F5DC"], sizes: ["8", "9", "10", "11"], isBestSeller: true },
              { name: "Elegant Shoe 8", price: 75.00, image: "/assets/shoes/nm_4735356_100188_m.jpeg", category: "shoes", colors: ["#000000"], sizes: ["6", "7", "8"] },
              { name: "Stylish Shoe 9", price: 105.00, image: "/assets/shoes/nm_4623078_100602_m.jpeg", category: "shoes", colors: ["#FFFFFF", "#FFC0CB"], sizes: ["7", "8", "9"], isNew: true },
              { name: "Comfortable Shoe 10", price: 99.99, image: "/assets/shoes/nm_2502690_100106_m.jpeg", category: "shoes", colors: ["#A0522D", "#000000"], sizes: ["8", "9", "10", "11", "12"] },
              // Clothes (Using S-M-L sizes)
              { name: "Stylish Top 1", price: 49.95, image: "/assets/clothes/nm_5008742_100106_m.jpeg", category: "clothes", colors: ["#ADD8E6", "#FFFFFF"], sizes: ["S", "M", "L"], matchingSet: true },
              { name: "Comfy Pants 2", price: 59.95, image: "/assets/clothes/nm_4988442_100106_m.jpeg", category: "clothes", colors: ["#000000"], sizes: ["XS", "S", "M"] },
              { name: "Elegant Dress 3", price: 120.00, image: "/assets/clothes/nm_4961408_100550_m.jpeg", category: "clothes", colors: ["#F5F5DC", "#FFC0CB"], sizes: ["S", "M", "L", "XL"], isNew: true },
              { name: "Casual Shirt 4", price: 39.00, image: "/assets/clothes/nm_4959949_100106_m.jpeg", category: "clothes", colors: ["#FFFFFF", "#A0522D"], sizes: ["M", "L"] },
              { name: "Basic Tee 5", price: 25.00, image: "/assets/clothes/nm_4946782_100550_m.jpeg", category: "clothes", colors: ["#000000", "#FFFFFF"], sizes: ["S", "M", "L", "XL"], isBestSeller: true },
              { name: "Warm Sweater 6", price: 75.50, image: "/assets/clothes/nm_4943384_100106_m.jpeg", category: "clothes", colors: ["#ADD8E6", "#8B4513"], sizes: ["M", "L", "XL"] },
              { name: "Summer Skirt 7", price: 65.00, image: "/assets/clothes/nm_4939109_100241_m.jpeg", category: "clothes", colors: ["#FFFFFF"], sizes: ["XS", "S", "M"] , isNew: true },
              { name: "Denim Jacket 8", price: 110.00, image: "/assets/clothes/nm_4936319_100055_m.jpeg", category: "clothes", colors: ["#00008B"], sizes: ["S", "M", "L"] },
              { name: "Linen Trousers 9", price: 88.00, image: "/assets/clothes/nm_4925658_100189_m.jpeg", category: "clothes", colors: ["#F5F5DC"], sizes: ["S", "M", "L"] },
              { name: "Silk Blouse 10", price: 92.00, image: "/assets/clothes/nm_4921059_100324_m.tiff.jpeg", category: "clothes", colors: ["#FFFFFF", "#A0522D"], sizes: ["XS", "S", "M"], isBestSeller: true },
              { name: "Wool Coat 11", price: 250.00, image: "/assets/clothes/nm_4915015_100244_m.tiff.jpeg", category: "clothes", colors: ["#000000", "#8B4513"], sizes: ["M", "L", "XL"] },
              { name: "Cotton Shorts 12", price: 45.00, image: "/assets/clothes/nm_3519921_100404_m.jpeg", category: "clothes", colors: ["#ADD8E6", "#FFFFFF"], sizes: ["S", "M", "L"] , isNew: true },
              { name: "Vintage T-Shirt 13", price: 30.00, image: "/assets/clothes/nm_2471915_100380_m.jpeg", category: "clothes", colors: ["#FFFFFF", "#000000", "#FF0000"], sizes: ["S", "M", "L", "XL"] }
            ];
            // Need to serialize arrays to JSON for MySQL JSON columns
            const initialProductsForSql = initialProducts.map(p => ({
                ...p,
                colors: JSON.stringify(p.colors || []), // Serialize colors or use empty array
                sizes: JSON.stringify(p.sizes || [])   // Serialize sizes or use empty array
            }));
            await SqlProduct.bulkCreate(initialProductsForSql);
            console.log('SQL Database seeded with 23 products!');
        } else {
             console.log('SQL Products table already seeded.');
        }

        // Seed Promotions into SQL if table is empty
        const promoCountSql = await SqlPromotion.count();
        if (promoCountSql === 0) {
             console.log('No promotions found in SQL, seeding database...');
             const initialPromotions = [
                 {
                     code: 'WELCOME10',
                     description: '10% off your first order!',
                     discountType: 'PERCENTAGE',
                     discountValue: 10,
                     isActive: true,
                     maxUsesPerUser: 1
                     // applicableTier, minSpend, etc. use defaults
                 },
                 {
                     code: 'FREESHIP100',
                     description: 'Free Shipping (Silver Tier - 100+ points)',
                     discountType: 'FREE_SHIPPING',
                     discountValue: 0, 
                     isActive: true,
                     applicableTier: 'Silver',
                     maxUsesPerUser: null // Can be used multiple times once unlocked
                 },
                 {
                     code: 'GOLD10',
                     description: '10% Off (Gold Tier - 500+ points)',
                     discountType: 'PERCENTAGE',
                     discountValue: 10,
                     isActive: true,
                     applicableTier: 'Gold',
                     maxUsesPerUser: null
                 }
             ];
             await SqlPromotion.bulkCreate(initialPromotions);
             console.log('SQL Database seeded with initial promotions!');
        } else {
             console.log('SQL Promotions table already seeded.');
        }

    } catch (err) {
        console.error('Error seeding database:', err);
    }
}
seedDatabase(); // Run the seeding check on server start

// Get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());

// --- Add Global Request Logger ---
app.use((req, res, next) => {
  console.log(`[Request Logger] Received: ${req.method} ${req.originalUrl}`);
  next(); // Pass control to the next middleware function
});
// --- End Global Request Logger ---

// app.use(express.static(path.join(__dirname))); // <-- MOVE THIS LINE

// --- Webhook Endpoint (needs to be before express.json() for raw body) ---
// Use express.raw middleware for the webhook route BEFORE express.json()
app.post('/api/stripe-webhook', express.raw({type: 'application/json'}), async (request, response) => { // Made async
  console.log("[Stripe Webhook] Received event");
  const sig = request.headers['stripe-signature'];
  let event;

  if (!STRIPE_WEBHOOK_SECRET) {
      console.error('*** Stripe Webhook Secret is missing. Please set STRIPE_WEBHOOK_SECRET in your .env file ***');
      return response.status(400).send(`Webhook Error: Missing webhook secret`);
  }
  if (!sig) {
      console.error('*** Stripe Webhook Error: Missing stripe-signature header ***');
      return response.status(400).send(`Webhook Error: Missing signature`);
  }

  try {
    event = stripe.webhooks.constructEvent(request.body, sig, STRIPE_WEBHOOK_SECRET);
    console.log("[Stripe Webhook] Event constructed successfully:", event.id, event.type);
  } catch (err) {
    console.error(`[Stripe Webhook] Error verifying webhook signature: ${err.message}`);
    return response.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log(`[Stripe Webhook] Checkout Session Completed for session ${session.id}`);

      // --- Fulfill the order --- 
      if (session.payment_status === 'paid') {
        console.log("[Stripe Webhook] Payment was successful. Fulfilling order using SQL...");
        // Start SQL fulfillment process (run async function)
        fulfillOrderSql(session).catch(err => { // <-- Changed to fulfillOrderSql
           console.error("[Stripe Webhook] Error fulfilling SQL order:", err);
           // Decide how to handle fulfillment failure - retry? notify admin?
           // For now, we just log it. A robust system needs error handling.
        });
      } else {
          console.log(`[Stripe Webhook] Payment status is ${session.payment_status}. Order not fulfilled.`);
      }
      break;
    // ... handle other event types (payment_intent.succeeded, etc.)
    default:
      console.log(`[Stripe Webhook] Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  response.json({received: true});
});
// --- End Webhook Endpoint ---

// Apply express.json() globally AFTER the webhook endpoint
app.use(express.json());

// --- API Endpoints using MySQL for Products (Refactored) ---

// GET all products (with sorting, filtering, and count) - REFRACTORED for MySQL
app.get('/api/products', async (req, res) => {
  try {
    const { category, color, size, isNew, isBestSeller, sort } = req.query;
    const whereOptions = {};
    let orderOptions = [];

    // --- Filtering --- 
    if (category) whereOptions.category = category;
    if (isNew === 'true') whereOptions.isNew = true;
    if (isBestSeller === 'true') whereOptions.isBestSeller = true;
    // Filtering by JSON arrays (color, size) is more complex in SQL/Sequelize
    // Example for color (requires specific DB function support like JSON_CONTAINS)
    // if (color) whereOptions.colors = sequelize.fn('JSON_CONTAINS', sequelize.col('colors'), JSON.stringify(color));
    // For simplicity, JSON filtering is omitted for now.

    // --- Sorting --- 
    if (sort === 'price-asc') orderOptions.push(['price', 'ASC']);
    else if (sort === 'price-desc') orderOptions.push(['price', 'DESC']);
    else if (sort === 'popularity-desc') orderOptions.push(['wishlistCount', 'DESC']);
    // Add default sort if needed, e.g., ['name', 'ASC']
    if (orderOptions.length === 0) {
        orderOptions.push(['name', 'ASC']); // Default sort by name
    }

    // --- Querying --- 
    const { count, rows } = await SqlProduct.findAndCountAll({
        where: whereOptions,
        order: orderOptions,
        // Add limit and offset here for pagination if needed
    });

    // --- Post-processing (Parse JSON columns) --- 
    const products = rows.map(p => {
        const productJson = p.toJSON(); // Get plain JSON object
        try {
            productJson.colors = JSON.parse(productJson.colors); // Parse colors
        } catch (e) { productJson.colors = []; } // Handle parsing error
        try {
            productJson.sizes = JSON.parse(productJson.sizes); // Parse sizes
        } catch (e) { productJson.sizes = []; } // Handle parsing error
        
        // Parse DECIMAL strings to numbers
        if (productJson.price !== null && productJson.price !== undefined) {
            productJson.price = parseFloat(productJson.price);
        }
        if (productJson.originalPrice !== null && productJson.originalPrice !== undefined) {
            productJson.originalPrice = parseFloat(productJson.originalPrice);
        }
        
        return productJson;
    });
    
    // Note: Review aggregation is removed as reviews are in MongoDB
    // We can fetch reviews separately if needed on the product detail page.
    
    res.json({ 
        products: products, 
        totalCount: count 
    });
    
  } catch (err) {
    console.error("Error fetching products from SQL:", err);
    res.status(500).json({ message: 'Error fetching products' });
  }
});

// GET product by ID - REFRACTORED for MySQL
app.get('/api/products/:id', async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10); // Ensure ID is integer
    if (isNaN(productId)) {
        return res.status(400).json({ message: 'Invalid product ID format' });
    }
    
    const productInstance = await SqlProduct.findByPk(productId);
    
    if (!productInstance) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    // --- Post-processing (Parse JSON columns) --- 
    const product = productInstance.toJSON();
    try {
        product.colors = JSON.parse(product.colors);
    } catch (e) { product.colors = []; }
    try {
        product.sizes = JSON.parse(product.sizes);
    } catch (e) { product.sizes = []; }

    // Parse DECIMAL strings to numbers
    if (product.price !== null && product.price !== undefined) {
        product.price = parseFloat(product.price);
    }
    if (product.originalPrice !== null && product.originalPrice !== undefined) {
        product.originalPrice = parseFloat(product.originalPrice);
    }

    // Note: Review aggregation removed
    // Fetch reviews separately from MongoDB if needed here or on frontend
    
    res.json(product); 
    
  } catch (err) {
     console.error("Error fetching product by ID from SQL:", err);
     res.status(500).json({ message: 'Error fetching product' });
  }
});

// API endpoint for searching products - REFRACTORED for MySQL
app.get('/api/search', async (req, res) => {
  const query = req.query.q; 
  console.log(`[Search API - SQL] Received search query: '${query}'`);

  if (!query) {
    console.log("[Search API - SQL] Query is empty, returning 400.");
    return res.status(400).json({ message: 'Search query cannot be empty' });
  }

  try {
    // Use Sequelize's Op.like for case-insensitive search (syntax might vary slightly based on SQL dialect)
    const { Op } = Sequelize; 
    const productInstances = await SqlProduct.findAll({
      where: {
        name: {
          [Op.like]: `%${query}%` // Case-insensitive depends on DB collation
        }
      }
    });

    // --- Post-processing (Parse JSON columns) --- 
    const products = productInstances.map(p => {
        const productJson = p.toJSON();
        try {
            productJson.colors = JSON.parse(productJson.colors);
        } catch (e) { productJson.colors = []; }
        try {
            productJson.sizes = JSON.parse(productJson.sizes);
        } catch (e) { productJson.sizes = []; }
            
        // Parse DECIMAL strings to numbers
        if (productJson.price !== null && productJson.price !== undefined) {
            productJson.price = parseFloat(productJson.price);
        }
        if (productJson.originalPrice !== null && productJson.originalPrice !== undefined) {
            productJson.originalPrice = parseFloat(productJson.originalPrice);
        }
        
        return productJson;
    });

    console.log(`[Search API - SQL] Found ${products.length} products matching query.`);

    if (!products || products.length === 0) {
      console.log("[Search API - SQL] No products found, returning 404.");
      // Keep 200 OK with empty array for search results typically
      return res.json([]); 
      // return res.status(404).json({ message: 'No products found matching your search.' });
    }

    res.json(products); 

  } catch (err) {
    console.error("[Search API - SQL] Error during product search:", err);
    res.status(500).json({ message: 'Error searching products' });
  }
});

// POST a new product (Example - Now uses SQL)
app.post('/api/products', async (req, res) => {
  try {
    // Serialize arrays to JSON before saving
    const productData = { ...req.body };
    if (productData.colors) productData.colors = JSON.stringify(productData.colors);
    if (productData.sizes) productData.sizes = JSON.stringify(productData.sizes);

    const newProduct = await SqlProduct.create(productData);
    
    // Parse JSON back for response consistency
    const savedProduct = newProduct.toJSON();
    try {
        savedProduct.colors = JSON.parse(savedProduct.colors);
    } catch (e) { savedProduct.colors = []; }
    try {
        savedProduct.sizes = JSON.parse(savedProduct.sizes);
    } catch (e) { savedProduct.sizes = []; }

    res.status(201).json(savedProduct);
  } catch (err) {
    console.error("Error creating SQL product:", err);
    // Add more specific error handling (e.g., validation errors)
    res.status(400).json({ message: 'Error creating product', error: err.message }); 
  }
});

// --- Authentication Routes ---

// Register a new user
app.post('/api/auth/register', async (req, res) => {
  console.log("[Register Route - SQL Primary] Received request");
  const { firstName, lastName, username, email, password } = req.body;
  console.log("[Register Route - SQL Primary] Received data:", { firstName, lastName, username, email, password: password ? '[PRESENT]' : '[MISSING]' });

  // --- Input Validation (Keep existing checks) --- 
  if (!firstName || !lastName || !username || !email || !password) {
    console.log("[Register Route - SQL Primary] Failed: Missing required fields");
    return res.status(400).json({ message: 'All fields are required' }); 
  }
  // Password complexity checks...
  console.log("[Register Route - SQL Primary] Checking password length...");
  if (password.length < 8) {
    console.log("[Register Route - SQL Primary] Failed: Password too short");
    return res.status(400).json({ message: 'Password must be at least 8 characters long' });
  }
  console.log("[Register Route - SQL Primary] Checking password uppercase...");
  if (!/[A-Z]/.test(password)) {
    console.log("[Register Route - SQL Primary] Failed: No uppercase letter");
    return res.status(400).json({ message: 'Password must contain at least one uppercase letter' });
  }
  console.log("[Register Route - SQL Primary] Checking password special char...");
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]/.test(password)) {
    console.log("[Register Route - SQL Primary] Failed: No special character");
    return res.status(400).json({ message: 'Password must contain at least one special character' });
  }
  console.log("[Register Route - SQL Primary] Password validation passed.");
  // --- End Input Validation --- 

  const mongoSession = await mongoose.startSession();
  let sqlTransaction;

  try {
    console.log("[Register Route - SQL Primary] Entering TRY block...");
    sqlTransaction = await sequelize.transaction(); // Start SQL transaction
    mongoSession.startTransaction(); // Start Mongo transaction

    // Check if username or email already exists in SQL DB
    const existingSqlUser = await SqlUser.findOne({ 
        where: { 
            [Sequelize.Op.or]: [ { email: email.toLowerCase() }, { username: username.toLowerCase() } ] 
        },
        transaction: sqlTransaction
    });
    if (existingSqlUser) {
        let message = 'Registration failed.';
        if (existingSqlUser.email === email.toLowerCase()) {
            message = 'Email already in use';
        } else if (existingSqlUser.username === username.toLowerCase()) {
            message = 'Username already taken';
        }
        await sqlTransaction.rollback(); // Rollback SQL
        await mongoSession.abortTransaction(); // Abort Mongo
      return res.status(400).json({ message: message });
    }

    // Also check MongoDB just in case (e.g., during transition or if data is inconsistent)
    const existingMongoUser = await User.findOne({ 
        $or: [ { email: email.toLowerCase() }, { username: username.toLowerCase() } ] 
    }).session(mongoSession);
    if (existingMongoUser) {
        await sqlTransaction.rollback();
        await mongoSession.abortTransaction();
        return res.status(400).json({ message: 'Email or Username already exists (Mongo check).' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10); 
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create and save user to SQL
    const savedSqlUser = await SqlUser.create({
        firstName,
        lastName,
        username: username.toLowerCase(),
        email: email.toLowerCase(), 
        password: hashedPassword,
        // mongoUserId will be set after Mongo user is created
        // loyaltyPoints defaults to 0
    }, { transaction: sqlTransaction });

    // Create minimal user in MongoDB (for wishlist, etc.)
    const minimalMongoUser = new User({
        email: savedSqlUser.email, 
        username: savedSqlUser.username,
        firstName: savedSqlUser.firstName, // Keep basic info synced if needed
        lastName: savedSqlUser.lastName,
        password: '__MYSQL_AUTH__', // Indicate auth is handled by SQL
        wishlist: [] // Initialize empty wishlist
        // loyaltyPoints are now primarily in SQL
    });
    const savedMongoUser = await minimalMongoUser.save({ session: mongoSession });

    // Update SQL user with Mongo ID
    savedSqlUser.mongoUserId = savedMongoUser._id.toString();
    await savedSqlUser.save({ transaction: sqlTransaction });

    console.log(`[Register Route - SQL Primary] User ${savedSqlUser.username} saved to SQL (ID: ${savedSqlUser.id}) and Mongo (ID: ${savedMongoUser._id}).`);

    // Commit transactions
    await sqlTransaction.commit();
    await mongoSession.commitTransaction();

    // --- Auto-login: Generate JWT using SQL User ID --- 
    const payload = {
      user: {
        id: savedSqlUser.id // Use SQL ID
      }
    };

    jwt.sign(
      payload,
      JWT_SECRET,
      { expiresIn: '1h' }, 
      (err, token) => {
        if (err) {
             console.error("Token signing error after registration:", err);
             return res.status(201).json({ 
                 message: 'User registered successfully, but token generation failed.', 
                 userId: savedSqlUser.id // Return SQL ID
             });
        }
        res.status(201).json({ 
            message: 'User registered successfully', 
            userId: savedSqlUser.id, // Return SQL ID
            token: token // Include token
        }); 
      }
    );

  } catch (err) {
    console.error("Registration Error (SQL Primary):", err);
    // Rollback transactions on any error
    if (sqlTransaction) await sqlTransaction.rollback();
    if (mongoSession.inTransaction()) await mongoSession.abortTransaction();
    
    // Check for specific Sequelize validation errors if needed
    res.status(500).json({ message: 'Error registering user' });
  } finally {
      if (mongoSession) mongoSession.endSession();
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  const { identifier, password } = req.body; 

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Email/Username and password are required' });
  }

  try {
    // Find user by email or username in SQL DB
    const user = await SqlUser.findOne({ 
      where: { 
          [Sequelize.Op.or]: [ 
        { email: identifier.toLowerCase() }, 
        { username: identifier.toLowerCase() } 
      ]
        }
     });
     
    if (!user) {
      console.log(`[Login - SQL] User not found for identifier: ${identifier}`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Compare password with the hash stored in SQL
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log(`[Login - SQL] Password mismatch for identifier: ${identifier}`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // User matched, create JWT payload using SQL User ID
    const payload = {
      user: {
        id: user.id // Use SQL ID
      }
    };

    // Sign the token
    jwt.sign(
      payload,
      JWT_SECRET,
      { expiresIn: '1h' }, 
      (err, token) => {
        if (err) throw err;
        console.log(`[Login - SQL] Login successful for user ID: ${user.id}`);
        res.json({ token });
      }
    );

  } catch (err) {
    console.error("Login Error (SQL):", err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// --- End Authentication Routes ---

// --- User Data Route (Protected) --- Refactored
app.get('/api/users/me', authMiddleware, async (req, res) => {
  try {
    // req.sqlUser is attached by authMiddleware (excluding password)
    const sqlUser = req.sqlUser; 
    if (!sqlUser) {
      // This case might occur if the Mongo user lookup failed in middleware 
      // but we allowed it to proceed. Or if sqlUser wasn't attached properly.
      console.error('[GET /api/users/me] req.sqlUser not found after authMiddleware.');
      return res.status(404).json({ message: 'User data not found'});
    }

    // Fetch the corresponding Mongo user to get the wishlist
    const mongoUser = await User.findOne({ email: sqlUser.email }).select('wishlist');
    const wishlist = mongoUser ? mongoUser.wishlist : []; // Default to empty array if no mongo user

    // --- Analyze Order History for Preferred Category (SQL) ---
    let preferredCategory = null;
    try {
      const orders = await SqlOrder.findAll({
        where: { userId: sqlUser.id },
        include: [
          { 
            model: SqlOrderItem, 
            as: 'items',
            attributes: ['productId'], // Only need product ID from items
            include: [ 
              { 
                model: SqlProduct,
                attributes: ['category'] // Only need category from product
              }
            ]
          }
        ],
        // Limit to recent orders? Optional.
        // order: [[ 'orderDate', 'DESC' ]],
        // limit: 20 
      });

      const categoryCounts = {};
      let maxCount = 0;

      orders.forEach(order => {
        order.items?.forEach(item => {
          const category = item.SqlProduct?.category; // Use association name
          if (category) {
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
            if (categoryCounts[category] > maxCount) {
              maxCount = categoryCounts[category];
              preferredCategory = category;
            }
          }
        });
      });

      console.log(`[User Analysis] User ${sqlUser.id} category counts:`, categoryCounts);
      console.log(`[User Analysis] User ${sqlUser.id} preferred category: ${preferredCategory}`);

    } catch (analysisError) {
      console.error(`[User Analysis] Error analyzing order history for user ${sqlUser.id}:`, analysisError);
      // Don't fail the whole request, just proceed without preferredCategory
    }
    // --- End Analysis ---

    // Combine SQL and Mongo data for response
    const responseData = {
        id: sqlUser.id, // SQL ID
        mongoId: sqlUser.mongoUserId, // Mongo ID (if needed by frontend)
        firstName: sqlUser.firstName,
        lastName: sqlUser.lastName,
        username: sqlUser.username,
        email: sqlUser.email,
        loyaltyPoints: sqlUser.loyaltyPoints,
        wishlist: wishlist,
        createdAt: sqlUser.createdAt, // From SQL
        preferredCategory: preferredCategory // Add the analyzed category
    };

    res.json(responseData); // Send combined user data

  } catch (err) {
    console.error("Error fetching combined user data:", err);
    res.status(500).json({ message: 'Server error fetching user data' });
  }
});

// --- Wishlist Routes (Protected) ---

// GET user's wishlist (Reads from MongoDB User)
app.get('/api/users/me/wishlist', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('wishlist');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    // Here, user.wishlist contains MongoDB ObjectIds
    // If products are now in SQL, we might need to change what's stored/
    // returned. For now, returning the Mongo IDs.
    // TODO: Decide if wishlist array should store SQL IDs instead.
    res.json(user.wishlist); 
  } catch (err) {
    console.error("Error fetching user wishlist:", err);
    res.status(500).json({ message: 'Server error fetching wishlist' });
  }
});

// Add item to wishlist (Updates MongoDB User and SQL Product)
app.post('/api/users/me/wishlist', authMiddleware, async (req, res) => {
  const { productId } = req.body; // This is now expected to be the SQL Product ID
  const mongoUserId = req.user.id; // This is the MongoDB User ID from the token

  // Validate SQL Product ID (assuming it's numeric)
  const sqlProductId = parseInt(productId, 10);
  if (isNaN(sqlProductId)) {
    return res.status(400).json({ message: 'Valid SQL Product ID is required' });
  }

  const mongoSession = await mongoose.startSession(); // Mongo transaction for User update
  let sqlTransaction; // Sequelize transaction for Product update

  try {
    sqlTransaction = await sequelize.transaction();
    mongoSession.startTransaction(); // Start Mongoose transaction

    // 1. Find Mongo User
    const user = await User.findById(mongoUserId).session(mongoSession);
    if (!user) {
        throw new Error('Mongo User not found'); // Internal error
    }

    // 2. Find SQL Product (to ensure it exists)
    const product = await SqlProduct.findByPk(sqlProductId, { transaction: sqlTransaction });
    if (!product) {
        throw new Error('SQL Product not found');
    }

    // --- Store SQL Product ID in Mongo User Wishlist --- 
    // Decision: Store SQL ID as a string in the Mongo wishlist array.
    const productIdString = sqlProductId.toString();
    const isAlreadyWishlisted = user.wishlist.map(id => id.toString()).includes(productIdString);

    // 3. Update Mongo User Wishlist
    if (!isAlreadyWishlisted) {
        await User.updateOne({ _id: mongoUserId }, 
            { $addToSet: { wishlist: productIdString } }, // Add SQL ID as string
            { session: mongoSession }
        );
    } 

    // 4. Update SQL Product Count (only if newly added)
    if (!isAlreadyWishlisted) {
        await SqlProduct.increment('wishlistCount', { 
            by: 1, 
            where: { id: sqlProductId }, 
            transaction: sqlTransaction 
        });
        console.log(`[Wishlist Add] Incremented wishlistCount for SQL product ${sqlProductId}`);
    } else {
        console.log(`[Wishlist Add] SQL Product ${sqlProductId} already in wishlist for user ${mongoUserId}. Count not incremented.`);
    }

    // 5. Commit both transactions
    await sqlTransaction.commit();
    await mongoSession.commitTransaction();

    res.status(200).json({ message: 'Product added to wishlist' });

  } catch (err) {
    console.error("Error adding to wishlist (SQL/Mongo):", err);
    // Rollback transactions on error
    if (sqlTransaction) await sqlTransaction.rollback();
    if (mongoSession.inTransaction()) await mongoSession.abortTransaction();
    
    if (err.message === 'SQL Product not found') {
         res.status(404).json({ message: 'Product not found' });
    } else {
    res.status(500).json({ message: 'Server error adding to wishlist' });
    }
  } finally {
      if (mongoSession) mongoSession.endSession();
  }
});

// Remove item from wishlist (Updates MongoDB User and SQL Product)
app.delete('/api/users/me/wishlist/:productId', authMiddleware, async (req, res) => {
  const { productId } = req.params; // Expecting SQL Product ID
  const mongoUserId = req.user.id; // Mongo User ID

  const sqlProductId = parseInt(productId, 10);
  if (isNaN(sqlProductId)) {
    return res.status(400).json({ message: 'Valid SQL Product ID is required' });
  }

  const mongoSession = await mongoose.startSession(); 
  let sqlTransaction;

  try {
    sqlTransaction = await sequelize.transaction();
    mongoSession.startTransaction(); 

    // 1. Find Mongo User
    const user = await User.findById(mongoUserId).session(mongoSession);
    if (!user) {
        throw new Error('Mongo User not found');
    }
    
    // --- Use SQL Product ID (as string) for checking/removal --- 
    const productIdString = sqlProductId.toString();
    const isCurrentlyWishlisted = user.wishlist.map(id => id.toString()).includes(productIdString);

    // 2. Update Mongo User Wishlist
    if (isCurrentlyWishlisted) {
        await User.updateOne({ _id: mongoUserId }, 
            { $pull: { wishlist: productIdString } }, // Pull SQL ID as string
            { session: mongoSession }
        );
    }

    // 3. Update SQL Product Count (if it was actually removed)
    if (isCurrentlyWishlisted) {
        await SqlProduct.decrement('wishlistCount', { 
            by: 1, 
            where: { id: sqlProductId }, 
            transaction: sqlTransaction 
        });
        console.log(`[Wishlist Remove] Decremented wishlistCount for SQL product ${sqlProductId}`);
    } else {
         console.log(`[Wishlist Remove] SQL Product ${sqlProductId} not found in wishlist for user ${mongoUserId}. Count not decremented.`);
    }
    
    // 4. Commit transactions
    await sqlTransaction.commit();
    await mongoSession.commitTransaction();

    res.status(200).json({ message: 'Product removed from wishlist' });

  } catch (err) {
    console.error("Error removing from wishlist (SQL/Mongo):", err);
    if (sqlTransaction) await sqlTransaction.rollback();
    if (mongoSession.inTransaction()) await mongoSession.abortTransaction();
    res.status(500).json({ message: 'Server error removing from wishlist' });
  } finally {
      if (mongoSession) mongoSession.endSession();
  }
});

// --- End Wishlist Routes ---

// --- Loyalty Points API Endpoint (Refactored) ---
app.get('/api/users/me/loyalty', authMiddleware, async (req, res) => {
    try {
        // User is already fetched and attached by authMiddleware as req.sqlUser
        const sqlUser = req.sqlUser;
        if (!sqlUser) {
            // Should be caught by authMiddleware, but double-check
             console.error('[GET /api/users/me/loyalty] req.sqlUser not found after authMiddleware.');
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ loyaltyPoints: sqlUser.loyaltyPoints });
    } catch (error) {
        console.error("Error fetching loyalty points from SQL user:", error);
        res.status(500).json({ message: 'Error fetching loyalty points' });
    }
});

// --- Checkout Route (Protected - Creates Stripe Session, Needs Order Refactor) ---
app.post('/api/checkout', authMiddleware, async (req, res) => {
  console.log("[Checkout Route] Received request");
  const { cart, shippingAddress, appliedPromoCode } = req.body; // Add appliedPromoCode
  const sqlUserId = req.sqlUser?.id; // Use SQL User ID from middleware

  if (!sqlUserId) {
    return res.status(401).json({ message: 'User not authenticated or SQL user ID missing.' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Calculate subtotal (before discount)
    let subTotal = 0;
    const orderItems = cart.map(item => {
        if (!item.id || !item.name || item.price == null || !item.quantity) {
            throw new Error('Cart item is missing required fields (id, name, price, quantity).');
        }
        const itemTotal = item.price * item.quantity;
        subTotal += itemTotal;
        return {
            product: item.id, // Changed from productId to product to match schema
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            // color: item.color, // Color/Size not in OrderItemSchema, add if needed
            // size: item.size
        };
    });

    let discountAmount = 0;
    let finalTotal = subTotal;
    let validatedPromoCode = null;

    // --- Apply Promotion Code if provided ---
    if (appliedPromoCode) {
        const code = appliedPromoCode.toUpperCase().trim();
        const promotion = await Promotion.findOne({ code: code }).session(session); // Run query in transaction

        // Re-validate the promotion (similar checks as /api/apply-promotion)
        let promoIsValid = true;
        let validationError = null;

        if (!promotion) {
            promoIsValid = false; 
            validationError = 'Invalid promotion code.';
        } else if (!promotion.isActive) {
            promoIsValid = false; 
            validationError = 'Promotion is not active.';
        } // Add date, usage limit checks etc. if needed
        else {
             // Re-check user eligibility (tier, first order etc.)
             const user = await User.findById(sqlUserId).select('loyaltyPoints').session(session);
             // Add tier check logic here based on promotion.applicableTier and user.loyaltyPoints
             if (promotion.applicableTier) {
                 const tiers = { Silver: 100, Gold: 500 };
                 let userTierMet = false;
                 if (promotion.applicableTier === 'Silver' && user.loyaltyPoints >= tiers.Silver) userTierMet = true;
                 if (promotion.applicableTier === 'Gold' && user.loyaltyPoints >= tiers.Gold) userTierMet = true;
                 if (!userTierMet) { promoIsValid = false; validationError = 'User tier requirement not met.'; }
             }
             // Re-check first order for WELCOME10
             if (promoIsValid && promotion.maxUsesPerUser === 1 && promotion.code === 'WELCOME10') {
                 const orderCount = await Order.countDocuments({ user: sqlUserId }).session(session);
                 if (orderCount > 0) { promoIsValid = false; validationError = 'Welcome offer already used.'; }
             }
             // Add other user-specific checks
        }
        
        if (promoIsValid) {
             validatedPromoCode = promotion.code; // Store validated code
            // Calculate discount
            if (promotion.discountType === 'PERCENTAGE') {
                discountAmount = (subTotal * promotion.discountValue) / 100;
            } else if (promotion.discountType === 'FIXED_AMOUNT') {
                discountAmount = promotion.discountValue;
            } else if (promotion.discountType === 'FREE_SHIPPING') {
                // Handle free shipping later (e.g., by setting shipping cost to 0)
                // For now, discountAmount remains 0 for this type
            }
            // Ensure discount doesn't exceed subtotal
            discountAmount = Math.min(discountAmount, subTotal);
            finalTotal = subTotal - discountAmount;
        } else {
            // If code provided but invalid during final checkout, throw error
            console.warn(`[Checkout Route] Promo code "${code}" invalid at final checkout: ${validationError}`);
            throw new Error(validationError || 'Invalid promotion code applied during checkout.');
        }
    }
    // --- End Apply Promotion Code --- 

    // Create the new order with updated totals and promo info
    const newOrder = new Order({
        user: sqlUserId, 
        items: orderItems,
        subTotal: subTotal, // Store subtotal
        appliedPromoCode: validatedPromoCode, // Store validated code or null
        discountAmount: discountAmount, // Store discount amount
        totalAmount: finalTotal, // Store final amount
        shippingAddress: shippingAddress,
        stripeSessionId: session.id // Store session ID for idempotency
    });

    await newOrder.save({ session });
    console.log(`[Checkout Route] Order ${newOrder._id} created for user ${sqlUserId}`);

    // --- Award Loyalty Points (Based on FINAL amount paid) --- 
    const pointsEarned = Math.floor(finalTotal); // Base points on the final discounted amount
    console.log(`[Checkout Route] Awarding ${pointsEarned} loyalty points to user ${sqlUserId}`);
    await User.findByIdAndUpdate(sqlUserId, 
        { $inc: { loyaltyPoints: pointsEarned } }, 
        { session } 
    );
    console.log(`[Checkout Route] Loyalty points updated for user ${sqlUserId}`);
    
    // --- Update Promotion Usage Count --- 
    if (validatedPromoCode) {
        await Promotion.updateOne(
            { code: validatedPromoCode }, 
            { $inc: { usageCount: 1 } },
            { session }
        );
         console.log(`[Checkout Route] Usage count incremented for promo code ${validatedPromoCode}`);
         // TODO: Add user-specific usage tracking if needed
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ message: 'Order placed successfully!', orderId: newOrder._id });

  } catch (error) {
    // If an error occurred, abort the whole transaction
    // Need to check if session exists before aborting/ending
    if (session && session.inTransaction()) {
         await session.abortTransaction();
         session.endSession();
    }    
    console.error("[Checkout Route] Error processing order:", error);
    // Send a more specific error if it's a validation issue from item mapping
    if (error.message.startsWith('Cart item is missing')) {
         return res.status(400).json({ message: error.message });
    }
    // Check for promo validation error message
    if (error.message.includes('promotion code applied during checkout') || error.message.includes('Invalid promotion code') || error.message.includes('tier requirement') || error.message.includes('already used')) {
         return res.status(400).json({ message: error.message }); 
    }
    res.status(500).json({ message: 'Failed to process order.' });
  }
});

// --- Get User Orders Route (Refactored for SQL) ---
app.get('/api/users/me/orders', authMiddleware, async (req, res) => {
  // Use SQL User ID from auth middleware
  const sqlUserId = req.sqlUser?.id; 
  if (!sqlUserId) {
      return res.status(401).json({ message: 'User not authenticated or SQL user ID missing.' });
  }
  console.log("[Get Orders Route SQL] Received request for user:", sqlUserId);

  try {
    const orders = await SqlOrder.findAll({
      where: { userId: sqlUserId },
      order: [[ 'orderDate', 'DESC' ]], // Correct sorting syntax
      include: [
        { 
          model: SqlOrderItem, 
          as: 'items', // Use the alias defined in association
          include: [ 
            { 
              model: SqlProduct, 
              attributes: ['id', 'name', 'image'] // Select specific product fields
            }
          ]
        }
      ]
                             });

    if (!orders) {
      // findAll returns [], so this check might not be strictly needed
      return res.status(404).json({ message: 'No orders found for this user.' });
    }

    // Post-processing might be needed if frontend expects specific structure
    const processedOrders = orders.map(order => {
        const orderJson = order.toJSON();
        
        // Parse top-level order prices (DECIMAL -> number)
        if (orderJson.subTotal !== null && orderJson.subTotal !== undefined) {
            orderJson.subTotal = parseFloat(orderJson.subTotal);
        }
        if (orderJson.discountAmount !== null && orderJson.discountAmount !== undefined) {
            orderJson.discountAmount = parseFloat(orderJson.discountAmount);
        }
        if (orderJson.totalAmount !== null && orderJson.totalAmount !== undefined) {
            orderJson.totalAmount = parseFloat(orderJson.totalAmount);
        }
        
        orderJson.items = orderJson.items.map(item => {
            // Rename item.SqlProduct to item.product for consistency if needed by frontend
            if (item.SqlProduct) { // Sequelize uses model name by default if no alias
                 item.product = item.SqlProduct;
                 delete item.SqlProduct;
            } 
            // Or if association alias was used: 
            // item.product = item.Product; delete item.Product;
            
            // Parse item price (DECIMAL -> number)
            if (item.price !== null && item.price !== undefined) {
                item.price = parseFloat(item.price);
            }
            
            return item;
        });
        return orderJson;
    });

    console.log(`[Get Orders Route SQL] Found ${processedOrders.length} orders for user ${sqlUserId}`);
    res.json(processedOrders); // Send the array of orders

    } catch (error) {
    console.error("[Get Orders Route SQL] Error fetching orders:", error);
    console.error("[Stripe Checkout] Error creating session:", error);
    res.status(500).json({ message: 'Failed to create Stripe checkout session.', error: error.message });
    }
});
// --- End Stripe Checkout Session Endpoint ---

// --- Feedback API Endpoint (Needs Update for SQL Product ID) ---
app.post('/api/feedback', authMiddleware, async (req, res) => {
    const { productId, rating, comment } = req.body;
    const mongoUserId = req.user?.id; // Mongo User ID for linking feedback
    const sqlUserId = req.sqlUser?.id; // SQL User ID for checking purchase
    const sqlProductId = productId ? parseInt(productId, 10) : null; // Expect SQL Product ID

    // Basic validation
    if (!comment) {
        return res.status(400).json({ message: 'Comment is required.' });
    }
    if (rating !== null && rating !== undefined && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
        return res.status(400).json({ message: 'Rating must be a number between 1 and 5.' });
    }
    // Validate SQL product ID if provided
    if (productId && isNaN(sqlProductId)) { 
        return res.status(400).json({ message: 'Invalid Product ID format.' });
    }
    // Ensure user is authenticated for product-specific feedback
    if (productId && (!sqlUserId || !mongoUserId)) {
         return res.status(401).json({ message: 'Authentication required to review a product.' });
    }
    // Ensure mongoUserId exists even for general feedback
    if (!mongoUserId) {
         return res.status(401).json({ message: 'Authentication required to submit feedback.' });
    }

    try {
        // --- Purchase Verification (SQL) --- 
        if (sqlProductId) {
            console.log(`[Feedback API SQL] Verifying purchase for user ${sqlUserId}, product ${sqlProductId}`);
            
            // Check if the user has ordered this product
            const orderCount = await SqlOrder.count({
                where: { userId: sqlUserId },
                include: [{
                    model: SqlOrderItem,
                    as: 'items',
                    where: { productId: sqlProductId },
                    required: true // INNER JOIN to ensure item exists
                }]
                // Optional: Add order status check if needed
                // where: { userId: sqlUserId, status: 'Completed' }
            });

            if (orderCount === 0) {
                console.log(`[Feedback API SQL] User ${sqlUserId} has not purchased product ${sqlProductId}. Feedback denied.`);
                return res.status(403).json({ message: 'You can only review products you have purchased.' });
            }
             console.log(`[Feedback API SQL] Purchase verified for user ${sqlUserId}, product ${sqlProductId}.`);
        }
        // --- End Purchase Verification ---

        // Still save Feedback to MongoDB, linking via Mongo User ID
        // Store the SQL Product ID if provided
        const newFeedback = new Feedback({
            user: mongoUserId, // Link feedback to Mongo User
            product: sqlProductId, // Store SQL Product ID (as number)
            rating: rating,
            comment: comment
        });

        await newFeedback.save();

        res.status(201).json({ message: 'Feedback submitted successfully!', feedbackId: newFeedback._id });

    } catch (error) {
        console.error("Error submitting feedback (SQL check):", error);
        res.status(500).json({ message: 'Failed to submit feedback.' });
    }
});

// --- Get Applicable Promotions Endpoint (Refactored for SQL) ---
app.get('/api/users/me/promotions', authMiddleware, async (req, res) => {
    const sqlUserId = req.sqlUser?.id;
    if (!sqlUserId) {
        return res.status(401).json({ message: 'User not authenticated.' });
    }
    const userLoyaltyPoints = req.sqlUser.loyaltyPoints;
    console.log(`[Get Promotions SQL] Request for user ${sqlUserId} with ${userLoyaltyPoints} points.`);

    try {
        const now = new Date();
        const { Op } = Sequelize;

        // Find potentially applicable promotions in SQL
        const activePromotions = await SqlPromotion.findAll({
            where: {
                isActive: true,
                [Op.or]: [
                    { startDate: { [Op.is]: null } }, // No start date OR
                    { startDate: { [Op.lte]: now } }  // Start date is in the past or now
                ],
                [Op.or]: [
                    { endDate: { [Op.is]: null } },   // No end date OR
                    { endDate: { [Op.gte]: now } }    // End date is in the future or now
                ],
                [Op.or]: [
                    { maxUses: { [Op.is]: null } }, // No max uses OR
                    { usageCount: { [Op.lt]: sequelize.col('maxUses') } } // Usage count is less than max uses
                ]
            }
        });

        // Define loyalty tiers (could be moved to config)
        const tiers = {
            Bronze: 0, // Assuming Bronze starts at 0
            Silver: 100,
            Gold: 500
        };

        // Filter based on user-specific criteria (tier, first order - requires querying Order table)
        const eligiblePromotions = [];
        for (const promo of activePromotions) {
            let userEligible = true;

            // 1. Check Loyalty Tier
            if (promo.applicableTier) {
                if (promo.applicableTier === 'Silver' && userLoyaltyPoints < tiers.Silver) userEligible = false;
                if (promo.applicableTier === 'Gold' && userLoyaltyPoints < tiers.Gold) userEligible = false;
                // Add Bronze if needed: if (promo.applicableTier === 'Bronze' && userLoyaltyPoints < tiers.Bronze) userEligible = false;
            }

            // 2. Check WELCOME10 (First Order Check) - Requires SQL Order Query
            // TODO: Re-implement first order check using SqlOrder if needed
            if (userEligible && promo.maxUsesPerUser === 1 && promo.code === 'WELCOME10') {
                try {
                    const orderCount = await SqlOrder.count({ where: { userId: sqlUserId } });
                    if (orderCount > 0) {
                        userEligible = false; // Not eligible if they have previous orders
                    }
                } catch (orderCheckError) {
                    console.error(`[Get Promotions SQL] Error checking order count for WELCOME10 for user ${sqlUserId}:`, orderCheckError);
                    // Decide how to handle - maybe exclude promo if check fails?
                    userEligible = false; 
                }
            }
            
            // 3. TODO: Check other maxUsesPerUser (requires tracking usage per user, maybe a separate table?)

            if (userEligible) {
                eligiblePromotions.push(promo.toJSON()); // Add plain object to results
            }
        }

        console.log(`[Get Promotions SQL] Found ${eligiblePromotions.length} eligible promotions for user ${sqlUserId}.`);
        res.json(eligiblePromotions);

    } catch (error) {
        console.error("[Get Promotions SQL] Error fetching promotions:", error);
        res.status(500).json({ message: 'Failed to fetch promotions.' });
    }
});

// --- Apply Promotion Code Endpoint (Refactored for SQL) ---
app.post('/api/apply-promotion', authMiddleware, async (req, res) => {
    const { code } = req.body;
    const sqlUserId = req.sqlUser?.id;

    if (!code) {
        return res.status(400).json({ message: 'Promotion code is required.' });
    }
    if (!sqlUserId) {
        return res.status(401).json({ message: 'User not authenticated.' });
    }
    const userLoyaltyPoints = req.sqlUser.loyaltyPoints;
    console.log(`[Apply Promotion SQL] Request for user ${sqlUserId}, code ${code}.`);

    try {
        const promoCode = code.toUpperCase().trim();
        const { Op } = Sequelize;

        // --- Check if it's a Personalized Wishlist/Category Code --- 
        const personalizedWishPrefix = `WISH-${sqlUserId}-`;
        const personalizedCatPrefix = `CAT-${sqlUserId}-`;
        let isPersonalized = false;
        let personalizedDesc = "";

        if (promoCode.startsWith('WISH-') && promoCode.startsWith(personalizedWishPrefix)) {
            isPersonalized = true;
            personalizedDesc = "10% off personalized offer";
        } else if (promoCode.startsWith('CAT-') && promoCode.startsWith(personalizedCatPrefix)) {
            isPersonalized = true;
            personalizedDesc = "10% off category fan offer";
        }

        if (isPersonalized) {
            console.log(`[Apply Promotion SQL] Detected personalized code pattern: ${promoCode}`);
            
            // --- Check Usage --- 
            const alreadyUsed = await PersonalizedCodeUsage.findOne({ where: { code: promoCode, userId: sqlUserId } });
            if (alreadyUsed) {
                console.log(`[Apply Promotion SQL] Personalized code ${promoCode} has already been used by user ${sqlUserId}.`);
                return res.status(400).json({ message: 'This personalized offer code has already been used.' });
            }
            // --- End Usage Check --- 
            
            // Define the standard discount for personalized wishlist codes
             const discountType = 'PERCENTAGE';
             const discountValue = 10;

            // --- Record Usage --- 
            // Do this *before* sending response, but accept it's not fully transactional with order placement
            try {
                await PersonalizedCodeUsage.create({ userId: sqlUserId, code: promoCode });
                 console.log(`[Apply Promotion SQL] Recorded usage for personalized code ${promoCode} for user ${sqlUserId}.`);
            } catch (usageError) {
                 console.error(`[Apply Promotion SQL] CRITICAL: Failed to record usage for personalized code ${promoCode} after validation!`, usageError);
                 // Decide how to handle - maybe still allow use but log error prominently? 
                 // Or return an error to prevent use if recording fails?
                 return res.status(500).json({ message: 'Failed to record promotion usage. Please try again.'});
            }
            // --- End Record Usage --- 

            console.log(`[Apply Promotion SQL] Personalized code ${promoCode} validated for user ${sqlUserId}.`);
             res.json({
                 message: 'Personalized promotion applied successfully!',
                 code: promoCode,
                 description: personalizedDesc, 
                 discountType: discountType,
                 discountValue: discountValue 
             });
             return; // Stop processing, don't check SqlPromotion table
        }
        // --- End Personalized Code Check --- 

        // --- Continue with standard validation for codes in SqlPromotion table --- 
        const promotion = await SqlPromotion.findOne({ where: { code: promoCode } });

        // --- Validation Checks ---
        if (!promotion) {
            return res.status(404).json({ message: 'Invalid promotion code.' });
        }
        if (!promotion.isActive) {
            return res.status(400).json({ message: 'This promotion is no longer active.' });
        }
        const now = new Date();
        if (promotion.startDate && promotion.startDate > now) {
             return res.status(400).json({ message: 'This promotion has not started yet.' });
        }
         if (promotion.endDate && promotion.endDate < now) {
             return res.status(400).json({ message: 'This promotion has expired.' });
         }
        if (promotion.maxUses !== null && promotion.usageCount >= promotion.maxUses) {
             return res.status(400).json({ message: 'This promotion has reached its usage limit.' });
        }
        
        // --- User-Specific Validation ---
        // Check loyalty tier
        if (promotion.applicableTier) {
             const tiers = { Bronze: 0, Silver: 100, Gold: 500 }; // Keep consistent
             let userTierMet = false;
             if (promotion.applicableTier === 'Silver' && userLoyaltyPoints >= tiers.Silver) userTierMet = true;
             if (promotion.applicableTier === 'Gold' && userLoyaltyPoints >= tiers.Gold) userTierMet = true;
             // Add Bronze check if needed
             if (!userTierMet) {
                 return res.status(403).json({ message: `You need ${promotion.applicableTier} tier for this promotion.` });
             }
        }

        // Check max uses per user (WELCOME10 check)
        // TODO: Implement tracking for other single-use codes if needed
        if (promotion.maxUsesPerUser === 1 && promotion.code === 'WELCOME10') {
             const orderCount = await SqlOrder.count({ where: { userId: sqlUserId } });
             if (orderCount > 0) {
                 return res.status(403).json({ message: 'Welcome offer is only for your first order.' });
             }
        }

        // --- Validation Passed --- 
        console.log(`[Apply Promotion SQL] Code ${promoCode} validated successfully for user ${sqlUserId}.`);
        // Return relevant promo details (convert DECIMAL to number for frontend)
        res.json({
            message: 'Promotion applied successfully!',
            code: promotion.code,
            description: promotion.description,
            discountType: promotion.discountType,
            discountValue: parseFloat(promotion.discountValue) // Convert Decimal to number
        });

    } catch (error) {
        console.error("[Apply Promotion SQL] Error applying promotion code:", error);
        res.status(500).json({ message: 'Failed to apply promotion code.' });
    }
});

// --- Stripe Checkout Session Endpoint ---
// ... existing code ...

// --- Get Personalized Offers Endpoint (NEW) ---
app.get('/api/users/me/personalized-offers', authMiddleware, async (req, res) => {
    const sqlUserId = req.sqlUser?.id;
    const mongoUserId = req.user?.id; // Still need mongo ID for user wishlist

    if (!sqlUserId || !mongoUserId) {
        return res.status(401).json({ message: 'User not authenticated.' });
    }
    console.log(`[Personalized Offers] Request for user SQL ID: ${sqlUserId}, Mongo ID: ${mongoUserId}`);

    try {
        // --- Get User Data (Wishlist from Mongo, Preferred Category from SQL Orders) ---
        let wishlistSqlProductIds = [];
        let preferredCategory = null; // This should already be calculated in /api/users/me, but recalculate here for demo
        
        // 1. Get Mongo User Wishlist
        const user = await User.findById(mongoUserId).select('wishlist');
        if (user && user.wishlist && user.wishlist.length > 0) {
            wishlistSqlProductIds = user.wishlist.map(idStr => parseInt(idStr, 10)).filter(id => !isNaN(id));
        }
        
        // 2. Analyze Order History for Preferred Category (Simplified version)
        try {
             const orders = await SqlOrder.findAll({
                where: { userId: sqlUserId },
                include: [{ model: SqlOrderItem, as: 'items', include: [{ model: SqlProduct, attributes: ['category']}] }]
             });
             const categoryCounts = {};
             let maxCount = 0;
             orders.forEach(order => {
                 order.items?.forEach(item => {
                     const category = item.SqlProduct?.category;
                     if (category) {
                         categoryCounts[category] = (categoryCounts[category] || 0) + 1;
                         if (categoryCounts[category] > maxCount) {
                             maxCount = categoryCounts[category];
                             preferredCategory = category;
                         }
                     }
                 });
             });
             console.log(`[Personalized Offers] User ${sqlUserId} preferred category: ${preferredCategory}`);
        } catch (analysisError) {
             console.error(`[Personalized Offers] Error analyzing order history for user ${sqlUserId}:`, analysisError);
        }
        // --- End User Data Fetching & Analysis ---
        
        let offerCode = null;
        let offerDescription = null;
        const discountType = 'PERCENTAGE';
        const discountValue = 10; // Standard 10% for these simple offers
        let offerGenerated = false;

        // --- Offer Generation Logic --- 
        if (wishlistSqlProductIds.length > 0) {
            // **Offer based on Wishlist**
            console.log(`[Personalized Offers] User ${sqlUserId} has items in wishlist.`);
            const offerBaseCode = `WISH-${sqlUserId}-`;
            const existingUsage = await PersonalizedCodeUsage.findOne({ where: { userId: sqlUserId, code: { [Sequelize.Op.like]: `${offerBaseCode}%` } } });

            if (!existingUsage) {
                const firstWishlistedProductId = wishlistSqlProductIds[0];
                const wishlistedProduct = await SqlProduct.findByPk(firstWishlistedProductId, { attributes: ['name'] });
                const productName = wishlistedProduct ? wishlistedProduct.name : 'an item you like';
                
                offerCode = `${offerBaseCode}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                offerDescription = `Enjoy 10% off your next order! We noticed you like ${productName}.`;
                if (preferredCategory) {
                     offerDescription += ` Great choice for ${preferredCategory.toLowerCase()} fans!`; // Add category context
                }
                offerGenerated = true;
            } else {
                 console.log(`[Personalized Offers] User ${sqlUserId} already used wishlist offer.`);
            }
        
        } else if (preferredCategory) {
            // **Offer based on Preferred Category (if wishlist empty)**
             console.log(`[Personalized Offers] User ${sqlUserId} has no wishlist, but preferred category: ${preferredCategory}.`);
             const offerBaseCode = `CAT-${sqlUserId}-`;
             const existingUsage = await PersonalizedCodeUsage.findOne({ where: { userId: sqlUserId, code: { [Sequelize.Op.like]: `${offerBaseCode}%` } } }); // Check for CAT code usage

             if (!existingUsage) {
                 offerCode = `${offerBaseCode}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                 offerDescription = `Enjoy 10% off your next order! Especially for fans of ${preferredCategory.toLowerCase()} products.`;
                 offerGenerated = true;
             } else {
                 console.log(`[Personalized Offers] User ${sqlUserId} already used category offer.`);
             }
        }

        // --- Construct and Return Offer --- 
        if (offerGenerated && offerCode) {
            const personalizedOffer = {
                code: offerCode,
                description: offerDescription,
                discountType: discountType,
                discountValue: discountValue,
                isPersonalized: true 
            };
            console.log(`[Personalized Offers] Generated offer for user ${sqlUserId}:`, personalizedOffer.code);
            res.json([personalizedOffer]); 
        } else {
            console.log(`[Personalized Offers] No eligible personalized offer generated for user ${sqlUserId}.`);
            res.json([]); // Return empty array if no offer generated
        }

    } catch (error) {
        console.error("[Personalized Offers] Error generating offers:", error);
        res.status(500).json({ message: 'Failed to generate personalized offers.' });
    }
});


// --- Apply Promotion Code Endpoint (Refactored for SQL) ---
// ... existing code ...

// --- Internal Feedback Analysis Endpoint (NEW) ---
app.get('/api/internal/feedback-analysis', async (req, res) => {
    // Basic security - In a real app, protect this with admin roles or internal network access
    console.log("[Internal Feedback Analysis] Request received.");
    try {
        // Fetch feedback that has a rating and is linked to a product (SQL Product ID)
        const feedbackWithRatings = await Feedback.find({
             rating: { $exists: true, $ne: null },
             product: { $exists: true, $ne: null }
        }).select('product rating'); // Select only needed fields

        if (feedbackWithRatings.length === 0) {
            return res.json({ message: "No product feedback with ratings found to analyze.", analysis: {} });
        }

        // Aggregate ratings per product ID
        const productRatings = {};
        feedbackWithRatings.forEach(fb => {
            const productId = fb.product.toString(); // Product ID is stored
            if (!productRatings[productId]) {
                productRatings[productId] = { totalRating: 0, count: 0 };
            }
            productRatings[productId].totalRating += fb.rating;
            productRatings[productId].count += 1;
        });

        // Calculate average ratings
        const analysisResults = {};
        for (const productId in productRatings) {
            const data = productRatings[productId];
            analysisResults[productId] = {
                count: data.count,
                averageRating: data.totalRating / data.count
            };
        }

        console.log("[Internal Feedback Analysis] Analysis complete:", analysisResults);
        res.json({ message: "Feedback analysis complete.", analysis: analysisResults });

    } catch (error) {
        console.error("[Internal Feedback Analysis] Error:", error);
        res.status(500).json({ message: "Failed to analyze feedback.", error: error.message });
    }
});


// --- Get Applicable Promotions Endpoint (Refactored for SQL) ---
// ... existing code ...

// --- Serve Static Files (Moved Here) ---
app.use(express.static(path.join(__dirname)));

// Ensure all routes not matched by API endpoints serve the index.html file
// NOTE: This should generally come AFTER your API routes
app.get('*', (req, res) => {
  // Avoid sending index.html for API-like paths that weren't matched
  if (req.originalUrl.startsWith('/api/')) {
      return res.status(404).json({ message: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 

// --- Helper function to fulfill order --- 
async function fulfillOrder(session) {
  const userId = session.client_reference_id;
  const stripeSessionId = session.id; // Get the session ID
  let deliveryAddress = {};
  let promoCode = null;
  
  // --- Idempotency Check --- 
  console.log(`[Fulfill] Checking for existing order with Stripe Session ID: ${stripeSessionId}`);
  try {
    const existingOrder = await Order.findOne({ stripeSessionId: stripeSessionId });
    if (existingOrder) {
      console.log(`[Fulfill] Order with Stripe Session ID ${stripeSessionId} already processed (Order ID: ${existingOrder._id}). Skipping.`);
      return; // Stop execution if order already exists
    }
    console.log(`[Fulfill] No existing order found for Stripe Session ID ${stripeSessionId}. Proceeding with fulfillment.`);
  } catch (checkError) {
    console.error("[Fulfill] Error checking for existing order:", checkError);
    throw new Error("Failed to check for existing order before fulfillment."); // Prevent proceeding if check fails
  }
  // --- End Idempotency Check ---

  try {
      deliveryAddress = JSON.parse(session.metadata.delivery_address || '{}');
      promoCode = session.metadata.promo_code || null;
      console.log("[Fulfill] User ID:", userId);
      console.log("[Fulfill] Delivery Address:", deliveryAddress);
      console.log("[Fulfill] Promo Code:", promoCode);
  } catch (parseError) {
       console.error("[Fulfill] Error parsing metadata:", parseError);
       throw new Error("Failed to parse order metadata from Stripe session.");
  }

  if (!userId) {
      throw new Error("Missing client_reference_id (userId) in Stripe session.");
  }

  // Retrieve full session with line items
  let lineItems;
  try {
      const fullSession = await stripe.checkout.sessions.retrieve(stripeSessionId, { 
          expand: ['line_items.data.price.product'] // Expand nested product data
      });
      lineItems = fullSession.line_items;
      if (!lineItems) {
          throw new Error("Could not retrieve line items from Stripe session.");
      }
      console.log("[Fulfill] Retrieved line items from Stripe.");
      // console.log(JSON.stringify(lineItems.data, null, 2)); // Log for debugging
  } catch (retrieveError) {
       console.error("[Fulfill] Error retrieving session details from Stripe:", retrieveError);
       throw new Error("Failed to retrieve full order details from Stripe.");
  }

  // Map Stripe line items to MongoDB OrderItemSchema format
  const orderItems = lineItems.data.map((item, index) => { // Added index for logging
      // Assuming basic product data was sent or expanded
      const productInfo = item.price.product;
      console.log(`[Fulfill] Processing Item ${index}: Stripe Product Info:`, JSON.stringify(productInfo, null, 2)); // Log productInfo
      
      // Extract MongoDB Product ID from metadata
      const mongoProductId = productInfo.metadata?.mongoProductId;
      console.log(`[Fulfill] Item ${index}: Extracted mongoProductId:`, mongoProductId); // Log extracted ID
      
      if (!mongoProductId) {
          // Handle case where metadata might be missing (log error, throw, etc.)
           console.error(`[Fulfill] Missing mongoProductId in metadata for Stripe product ${productInfo.id}`);
      }
      
      return {
          // Need a way to map Stripe Product ID back to your MongoDB Product ID if they differ
          // For now, let's assume name/price/qty is enough, or store your Mongo ID in Stripe product metadata
          product: mongoProductId, // Assign the extracted MongoDB product ID
          name: productInfo.name || item.description,
          quantity: item.quantity,
          price: item.price.unit_amount / 100, // Convert cents back to dollars
      };
  });

  const subTotal = session.amount_subtotal / 100;
  const totalAmount = session.amount_total / 100;
  const discountAmount = subTotal - totalAmount; // Calculate discount

  // --- MongoDB Transaction with Retry Logic ---
  const mongoSession = await mongoose.startSession();
  const maxRetries = 3; // Maximum number of retry attempts
  let attempt = 0;
  let transactionSucceeded = false;

  console.log("[Fulfill] Starting MongoDB transaction attempts...");

  while (attempt < maxRetries && !transactionSucceeded) {
    attempt++;
    console.log(`[Fulfill] Transaction Attempt #${attempt}`);
    try {
        await mongoSession.withTransaction(async () => {
            // 1. Create the Order document
            const newOrder = new Order({
                user: userId,
                items: orderItems,
                subTotal: subTotal,
                appliedPromoCode: promoCode,
                discountAmount: discountAmount,
                totalAmount: totalAmount,
                shippingAddress: { // Map parsed address
                    fullName: deliveryAddress.firstName + ' ' + deliveryAddress.lastName,
                    streetAddress: deliveryAddress.address,
                    city: deliveryAddress.city,
                    state: deliveryAddress.state,
                    postalCode: deliveryAddress.zipCode,
                    country: deliveryAddress.country
                },
                orderDate: new Date(),
                status: 'Completed',
                stripeSessionId: stripeSessionId // Store session ID for idempotency
            });
            await newOrder.save({ session: mongoSession });
            console.log(`[Fulfill] MongoDB Order ${newOrder._id} created (Attempt #${attempt}).`);

            // 2. Award Loyalty Points
            const pointsEarned = Math.floor(totalAmount);
            console.log(`[Fulfill] Awarding ${pointsEarned} loyalty points to user ${userId} (Attempt #${attempt}).`);
            await User.findByIdAndUpdate(userId,
                { $inc: { loyaltyPoints: pointsEarned } },
                { session: mongoSession, new: true }
            );
            console.log(`[Fulfill] Loyalty points updated for user ${userId} (Attempt #${attempt}).`);

            // 3. Update Promotion Usage Count
            if (promoCode) {
                await SqlUser.increment('loyaltyPoints', { 
                    by: pointsEarned, 
                    where: { id: sqlUserId }, 
                    transaction 
                });
                console.log(`[Fulfill SQL] Loyalty points updated for SQL user ${sqlUserId}.`);

                // 4. Update Promotion Usage Count (Now using SQL Promotion)
                try {
                    const promoUpdateResult = await SqlPromotion.increment('usageCount', { 
                         by: 1, 
                         where: { code: promoCode }, 
                         transaction 
                    });
                    // Check if the update actually affected a row (promo code existed)
                    if (promoUpdateResult[0][1] > 0) { // Result format depends on dialect/version
                         console.log(`[Fulfill SQL] Usage count incremented for SQL promo code ${promoCode}.`);
                    } else {
                         console.warn(`[Fulfill SQL] Attempted to increment usage count for non-existent SQL promo code ${promoCode}.`);
                    }
                } catch (promoError) {
                    // Log the error but don't necessarily fail the whole transaction
                    // It might be a concurrent update or other issue. Monitor logs.
                    console.error(`[Fulfill SQL] Failed to update usage count for SQL promo code ${promoCode}:`, promoError);
                }
            }

            // 5. Save to MySQL (Optional - If needed)
            // ... (existing optional SQL logic) ...

        }); // End mongoSession.withTransaction

        transactionSucceeded = true; // If withTransaction completes without error
        console.log(`[Fulfill] MongoDB transaction committed successfully on attempt #${attempt}.`);

    } catch (error) {
        console.error(`[Fulfill] Error during MongoDB transaction attempt #${attempt}:`, error);
        
        // Check for TransientTransactionError for retry
        if (error.hasErrorLabel && error.hasErrorLabel('TransientTransactionError') && attempt < maxRetries) {
            console.log(`[Fulfill] Transient transaction error detected. Retrying...`);
            const delay = Math.pow(2, attempt -1) * 100; 
            console.log(`[Fulfill] Waiting ${delay}ms before next retry.`);
            await new Promise(resolve => setTimeout(resolve, delay));
            // continue to the next iteration of the while loop
        
        // Check for duplicate key error on stripeSessionId (idempotency for concurrent requests)
        } else if (error.code === 11000 && error.keyPattern && error.keyPattern.stripeSessionId === 1) {
            console.log(`[Fulfill] Duplicate key error on stripeSessionId detected (Code 11000). Order likely processed by concurrent request. Treating as success.`);
            transactionSucceeded = true; // Treat as success for idempotency
            // Break the loop, no need to retry or throw
            break; 
        
        // Handle other non-retryable errors
        } else {
            console.error(`[Fulfill] Non-retryable error or max retries reached. Aborting transaction.`);
            // No need to explicitly call abortTransaction here, withTransaction handles it on error.
            throw error; // Re-throw the error to be caught by the webhook handler catch block
        }
    }
  } // End while loop

  // End the session outside the loop
  await mongoSession.endSession();
  console.log("[Fulfill] MongoDB session ended.");

  if (!transactionSucceeded) {
       console.error("[Fulfill] Transaction failed after all retry attempts.");
       // Throw an error or handle the persistent failure appropriately
       throw new Error("MongoDB transaction failed after multiple retries due to write conflicts.");
  }
}
// --- End Helper function --- 

// ... existing code ...

// --- Stripe Checkout Session Endpoint (NEW - Re-added and Refactored) ---
app.post('/api/create-checkout-session', authMiddleware, async (req, res) => {
  const { cart, deliveryAddress, appliedPromoCode } = req.body;
  const sqlUserId = req.sqlUser?.id;

  if (!sqlUserId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  if (!cart || cart.length === 0) {
    return res.status(400).json({ message: 'Cart is empty.' });
  }

  try {
    // 1. Transform cart items into Stripe's line_items format
    const line_items = cart.map(item => {
      if (!item.id || !item.name || item.price == null || !item.quantity) {
            throw new Error('Cart item is missing required fields (id, name, price, quantity).');
      }
      return {
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.name,
            // images: [item.image], // Optional: ensure item.image is a public URL if used
            metadata: { 
              sqlProductId: item.id.toString() // Store your SQL product ID as string
            }
          },
          unit_amount: Math.round(parseFloat(item.price) * 100), // Price in cents, ensure item.price is a number
        },
        quantity: item.quantity,
      };
    });

    // 2. Create metadata (ensure all values are strings for Stripe metadata)
    const metadata = {
      sqlUserId: sqlUserId.toString(), 
      delivery_address: JSON.stringify(deliveryAddress || {}),
      promo_code: appliedPromoCode || ''
    };
    
    // 3. Determine success and cancel URLs
    // Ensure YOUR_DOMAIN is set in your .env or defaults correctly
    const YOUR_DOMAIN = process.env.YOUR_DOMAIN || 'http://localhost:5173'; 

    // 4. Create the Stripe Checkout Session
    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: line_items,
      mode: 'payment',
      success_url: `${YOUR_DOMAIN}/order-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${YOUR_DOMAIN}/cart.html`, 
      client_reference_id: sqlUserId.toString(), 
      metadata: metadata,
      // --- Future enhancements: --- 
      // automatic_tax: { enabled: true },
      // shipping_address_collection: { allowed_countries: ['US', 'CA'] }, // If Stripe collects address
    });

    res.json({ sessionId: stripeSession.id }); // Send session ID to client

  } catch (error) {
    console.error("[Stripe Checkout] Error creating session:", error);
    let errorMessage = 'Failed to create Stripe checkout session.';
    if (error.message.startsWith('Cart item is missing')) {
        errorMessage = error.message;
    }
    res.status(500).json({ message: errorMessage, error: error.message });
  }
});
// --- End Stripe Checkout Session Endpoint ---

// ... existing code ...

// --- Helper function to fulfill order using SQL (NEW) ---
async function fulfillOrderSql(session) {
  const stripeSessionId = session.id;
  let sqlUserId, deliveryAddress = {}, promoCode = null;

  console.log(`[Fulfill SQL] Received checkout session: ${stripeSessionId}`);

  // --- Extract data from Stripe session --- 
  try {
      // IMPORTANT: Ensure client_reference_id is the SQL User ID
      sqlUserId = parseInt(session.client_reference_id, 10);
      if (isNaN(sqlUserId)) {
          throw new Error("Invalid client_reference_id (sqlUserId) in Stripe session.");
      }
      deliveryAddress = JSON.parse(session.metadata.delivery_address || '{}');
      promoCode = session.metadata.promo_code || null;
      console.log(`[Fulfill SQL] Extracted SQL User ID: ${sqlUserId}`);
      console.log("[Fulfill SQL] Delivery Address:", deliveryAddress);
      console.log("[Fulfill SQL] Promo Code:", promoCode);
  } catch (parseError) {
       console.error("[Fulfill SQL] Error parsing metadata or user ID:", parseError);
       throw new Error("Failed to parse order metadata from Stripe session.");
  }

  // --- Idempotency Check (SQL) --- 
  console.log(`[Fulfill SQL] Checking for existing SQL order with Stripe Session ID: ${stripeSessionId}`);
  try {
    const existingOrder = await SqlOrder.findOne({ where: { stripeSessionId: stripeSessionId } });
    if (existingOrder) {
      console.log(`[Fulfill SQL] SQL Order with Stripe Session ID ${stripeSessionId} already processed (Order ID: ${existingOrder.id}). Skipping.`);
      return; // Stop execution if order already exists
    }
    console.log(`[Fulfill SQL] No existing SQL order found for Stripe Session ID ${stripeSessionId}. Proceeding.`);
  } catch (checkError) {
    console.error("[Fulfill SQL] Error checking for existing SQL order:", checkError);
    throw new Error("Failed to check for existing SQL order before fulfillment."); 
  }
  // --- End Idempotency Check --- 

  // --- Retrieve full session with line items --- 
  let lineItems;
  try {
      const fullSession = await stripe.checkout.sessions.retrieve(stripeSessionId, { 
          expand: ['line_items.data.price.product'] 
      });
      lineItems = fullSession.line_items;
      if (!lineItems?.data?.length) {
          throw new Error("Could not retrieve valid line items from Stripe session.");
      }
      console.log("[Fulfill SQL] Retrieved line items from Stripe.");
  } catch (retrieveError) {
       console.error("[Fulfill SQL] Error retrieving session details from Stripe:", retrieveError);
       throw new Error("Failed to retrieve full order details from Stripe.");
  }

  // --- Map Stripe line items to SqlOrderItem format --- 
  let mappedOrderItems;
  try {
      mappedOrderItems = lineItems.data.map((item) => {
          const productInfo = item.price.product;
          // Extract SQL Product ID from metadata we added during session creation
          const sqlProductId = parseInt(productInfo.metadata?.sqlProductId, 10);
          
          if (isNaN(sqlProductId)) {
              console.error(`[Fulfill SQL] Missing or invalid sqlProductId in metadata for Stripe product ${productInfo.id}, Name: ${productInfo.name}`);
              throw new Error(`Missing SQL product ID for item ${productInfo.name || item.description}`);
          }
          
          return {
              productId: sqlProductId,
              name: productInfo.name || item.description, // Store name at time of order
              quantity: item.quantity,
              price: item.price.unit_amount / 100, // Price at time of order (convert cents)
          };
      });
  } catch (mappingError) {
       console.error("[Fulfill SQL] Error mapping line items:", mappingError);
       throw mappingError; // Re-throw to prevent proceeding
  }

  const subTotal = session.amount_subtotal / 100;
  const totalAmount = session.amount_total / 100;
  const discountAmount = subTotal - totalAmount; // Calculate discount

  // --- Sequelize Transaction --- 
  let transaction;
  try {
      console.log("[Fulfill SQL] Starting SQL transaction...");
      transaction = await sequelize.transaction();

      // 1. Create the SqlOrder record
      const newOrder = await SqlOrder.create({
          userId: sqlUserId,
          subTotal: subTotal,
          appliedPromoCode: promoCode,
          discountAmount: discountAmount,
          totalAmount: totalAmount,
          shippingFullName: deliveryAddress.firstName + ' ' + deliveryAddress.lastName,
          shippingStreetAddress: deliveryAddress.address,
          shippingCity: deliveryAddress.city,
          shippingState: deliveryAddress.state,
          shippingPostalCode: deliveryAddress.zipCode,
          shippingCountry: deliveryAddress.country,
          orderDate: new Date(),
          status: 'Completed', 
          stripeSessionId: stripeSessionId 
      }, { transaction });
      console.log(`[Fulfill SQL] SQL Order ${newOrder.id} created.`);

      // 2. Create SqlOrderItem records
      const itemsToCreate = mappedOrderItems.map(item => ({ ...item, orderId: newOrder.id }));
      await SqlOrderItem.bulkCreate(itemsToCreate, { transaction });
      console.log(`[Fulfill SQL] ${itemsToCreate.length} SQL OrderItem records created.`);

      // 3. Award Loyalty Points to SqlUser
      const pointsEarned = Math.floor(totalAmount); // Base points on final amount
      if (pointsEarned > 0) {
            console.log(`[Fulfill SQL] Awarding ${pointsEarned} loyalty points to SQL user ${sqlUserId}.`);
            await SqlUser.increment('loyaltyPoints', { 
                by: pointsEarned, 
                where: { id: sqlUserId }, 
                transaction 
            });
            console.log(`[Fulfill SQL] Loyalty points updated for SQL user ${sqlUserId}.`);
      } else {
          console.log(`[Fulfill SQL] No loyalty points to award for user ${sqlUserId} (Total: ${totalAmount}).`);
      }

      // 4. Update Promotion Usage Count (SQL Promotion)
      if (promoCode) {
            try {
                const promoUpdateResult = await SqlPromotion.increment('usageCount', { 
                     by: 1, 
                     where: { code: promoCode }, 
                     transaction 
                });
                // Check if the update actually affected a row (promo code existed)
                // The exact format of promoUpdateResult can vary, check Sequelize docs if needed
                // A simple check might be sufficient, or check affected rows count if returned
                if (promoUpdateResult && promoUpdateResult[0] && promoUpdateResult[0][1] > 0) { 
                     console.log(`[Fulfill SQL] Usage count incremented for SQL promo code ${promoCode}.`);
                } else {
                     console.warn(`[Fulfill SQL] Attempted to increment usage count for potentially non-existent SQL promo code ${promoCode}. Result:`, promoUpdateResult);
                }
            } catch (promoError) {
                // Log the error but don't necessarily fail the whole transaction
                console.error(`[Fulfill SQL] Failed to update usage count for SQL promo code ${promoCode}:`, promoError);
                // Decide if this should cause a rollback - maybe not, if the order itself is primary
            }
        }

      // Commit the transaction
      await transaction.commit();
      console.log("[Fulfill SQL] SQL transaction committed successfully.");

  } catch (error) {
      console.error("[Fulfill SQL] Error during SQL transaction:", error);
      // If transaction was started, roll it back
      if (transaction) {
          console.log("[Fulfill SQL] Rolling back SQL transaction...");
          await transaction.rollback();
          console.log("[Fulfill SQL] SQL transaction rolled back.");
      }
      // Re-throw the error so the webhook handler logs it
      throw error; 
  }
}
// --- End SQL Fulfillment Helper ---


// --- Get Personalized Offers Endpoint (NEW) ---
app.get('/api/users/me/personalized-offers', authMiddleware, async (req, res) => {
    const sqlUserId = req.sqlUser?.id;
    const mongoUserId = req.user?.id; // Still need mongo ID for user wishlist

    if (!sqlUserId || !mongoUserId) {
        return res.status(401).json({ message: 'User not authenticated.' });
    }
    console.log(`[Personalized Offers] Request for user SQL ID: ${sqlUserId}, Mongo ID: ${mongoUserId}`);

    try {
        // --- Get User Data (Wishlist from Mongo, Preferred Category from SQL Orders) ---
        let wishlistSqlProductIds = [];
        let preferredCategory = null; // This should already be calculated in /api/users/me, but recalculate here for demo
        
        // 1. Get Mongo User Wishlist
        const user = await User.findById(mongoUserId).select('wishlist');
        if (user && user.wishlist && user.wishlist.length > 0) {
            wishlistSqlProductIds = user.wishlist.map(idStr => parseInt(idStr, 10)).filter(id => !isNaN(id));
        }
        
        // 2. Analyze Order History for Preferred Category (Simplified version)
        try {
             const orders = await SqlOrder.findAll({
                where: { userId: sqlUserId },
                include: [{ model: SqlOrderItem, as: 'items', include: [{ model: SqlProduct, attributes: ['category']}] }]
             });
             const categoryCounts = {};
             let maxCount = 0;
             orders.forEach(order => {
                 order.items?.forEach(item => {
                     const category = item.SqlProduct?.category;
                     if (category) {
                         categoryCounts[category] = (categoryCounts[category] || 0) + 1;
                         if (categoryCounts[category] > maxCount) {
                             maxCount = categoryCounts[category];
                             preferredCategory = category;
                         }
                     }
                 });
             });
             console.log(`[Personalized Offers] User ${sqlUserId} preferred category: ${preferredCategory}`);
        } catch (analysisError) {
             console.error(`[Personalized Offers] Error analyzing order history for user ${sqlUserId}:`, analysisError);
        }
        // --- End User Data Fetching & Analysis ---
        
        let offerCode = null;
        let offerDescription = null;
        const discountType = 'PERCENTAGE';
        const discountValue = 10; // Standard 10% for these simple offers
        let offerGenerated = false;

        // --- Offer Generation Logic --- 
        if (wishlistSqlProductIds.length > 0) {
            // **Offer based on Wishlist**
            console.log(`[Personalized Offers] User ${sqlUserId} has items in wishlist.`);
            const offerBaseCode = `WISH-${sqlUserId}-`;
            const existingUsage = await PersonalizedCodeUsage.findOne({ where: { userId: sqlUserId, code: { [Sequelize.Op.like]: `${offerBaseCode}%` } } });

            if (!existingUsage) {
                const firstWishlistedProductId = wishlistSqlProductIds[0];
                const wishlistedProduct = await SqlProduct.findByPk(firstWishlistedProductId, { attributes: ['name'] });
                const productName = wishlistedProduct ? wishlistedProduct.name : 'an item you like';
                
                offerCode = `${offerBaseCode}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                offerDescription = `Enjoy 10% off your next order! We noticed you like ${productName}.`;
                if (preferredCategory) {
                     offerDescription += ` Great choice for ${preferredCategory.toLowerCase()} fans!`; // Add category context
                }
                offerGenerated = true;
            } else {
                 console.log(`[Personalized Offers] User ${sqlUserId} already used wishlist offer.`);
            }
        
        } else if (preferredCategory) {
            // **Offer based on Preferred Category (if wishlist empty)**
             console.log(`[Personalized Offers] User ${sqlUserId} has no wishlist, but preferred category: ${preferredCategory}.`);
             const offerBaseCode = `CAT-${sqlUserId}-`;
             const existingUsage = await PersonalizedCodeUsage.findOne({ where: { userId: sqlUserId, code: { [Sequelize.Op.like]: `${offerBaseCode}%` } } }); // Check for CAT code usage

             if (!existingUsage) {
                 offerCode = `${offerBaseCode}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                 offerDescription = `Enjoy 10% off your next order! Especially for fans of ${preferredCategory.toLowerCase()} products.`;
                 offerGenerated = true;
             } else {
                 console.log(`[Personalized Offers] User ${sqlUserId} already used category offer.`);
             }
        }

        // --- Construct and Return Offer --- 
        if (offerGenerated && offerCode) {
            const personalizedOffer = {
                code: offerCode,
                description: offerDescription,
                discountType: discountType,
                discountValue: discountValue,
                isPersonalized: true 
            };
            console.log(`[Personalized Offers] Generated offer for user ${sqlUserId}:`, personalizedOffer.code);
            res.json([personalizedOffer]); 
        } else {
            console.log(`[Personalized Offers] No eligible personalized offer generated for user ${sqlUserId}.`);
            res.json([]); // Return empty array if no offer generated
        }

    } catch (error) {
        console.error("[Personalized Offers] Error generating offers:", error);
        res.status(500).json({ message: 'Failed to generate personalized offers.' });
    }
});

// ... existing code ...