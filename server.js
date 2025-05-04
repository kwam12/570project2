import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose'; // Import mongoose
import bcrypt from 'bcryptjs'; // Import bcryptjs
import jwt from 'jsonwebtoken'; // Import jsonwebtoken

// --- JWT Secret ---
// IMPORTANT: Store this securely in environment variables for production!
const JWT_SECRET = process.env.JWT_SECRET || 'your-very-strong-secret-key'; 

// --- Authentication Middleware ---
const authMiddleware = (req, res, next) => {
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

    // Add user from payload to request object
    req.user = decoded.user; 
    next(); // Proceed to the next middleware or route handler
  } catch (err) {
    console.error('Token verification failed:', err.message);
    res.status(401).json({ message: 'Token is not valid' });
  }
};
// --- End Authentication Middleware ---

// --- MongoDB Connection ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/nourDB';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB connection error:', err));

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
    // Add other fields as needed
});
const Product = mongoose.model('Product', ProductSchema);


// User Schema - Add loyaltyPoints
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
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


// New Order Item Schema (Subdocument)
const OrderItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true }, // Store name at time of order
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true } // Store price at time of order
}, { _id: false }); // Prevent Mongoose from creating _id for subdocuments


// New Order Schema
const OrderSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: [OrderItemSchema], // Array of order items
    subTotal: { type: Number, required: true }, // Add subTotal before discount
    appliedPromoCode: { type: String, default: null },
    discountAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true }, // Final amount after discount
    orderDate: { type: Date, default: Date.now },
    status: { type: String, default: 'Completed', enum: ['Pending', 'Completed', 'Shipped', 'Cancelled'] }, // Example statuses
    shippingAddress: {
        fullName: String,
        streetAddress: String,
        city: String,
        state: String,
        postalCode: String,
        country: String
    },
    // paymentMethod: String,
    // paymentResult: { id: String, status: String, ... }
});
const Order = mongoose.model('Order', OrderSchema); // Create the Order model

// New Feedback Schema
const FeedbackSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, // Optional: Link feedback to a specific product
    rating: { type: Number, min: 1, max: 5 }, // Optional: Star rating
    comment: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', FeedbackSchema);

// New Promotion Schema
const PromotionSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, required: true },
    discountType: { type: String, required: true, enum: ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING'] },
    discountValue: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    applicableTier: { type: String, enum: [null, 'Bronze', 'Silver', 'Gold'], default: null }, // null means general
    minSpend: { type: Number, default: 0 },
    maxUses: { type: Number, default: null }, // null = unlimited
    maxUsesPerUser: { type: Number, default: 1 },
    startDate: { type: Date },
    endDate: { type: Date },
    usageCount: { type: Number, default: 0 } // Track total uses
}, { timestamps: true }); // Add createdAt/updatedAt automatically
const Promotion = mongoose.model('Promotion', PromotionSchema);

// --- Helper to add initial data (optional) ---
async function seedDatabase() {
    try {
        const count = await Product.countDocuments();
        if (count === 0) {
            console.log('No products found, seeding database...');
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
            await Product.insertMany(initialProducts);
            console.log('Database seeded with 23 products!');
        }

        // Seed Promotions (Only if none exist)
        const promoCount = await Promotion.countDocuments();
        if (promoCount === 0) {
             console.log('No promotions found, seeding database...');
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
             await Promotion.insertMany(initialPromotions);
             console.log('Database seeded with initial promotions!');
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
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- API Endpoints using MongoDB ---

// GET all products (with sorting, filtering, and count)
app.get('/api/products', async (req, res) => {
  try {
    // --- Filtering --- 
    const filterOptions = {};
    const category = req.query.category;
    const color = req.query.color;
    const size = req.query.size;
    const isNew = req.query.isNew === 'true';
    const isBestSeller = req.query.isBestSeller === 'true';

    if (category) filterOptions.category = category;
    if (color) filterOptions.colors = { $in: [color] }; 
    if (size) filterOptions.sizes = { $in: [size] };
    if (isNew) filterOptions.isNew = true;
    if (isBestSeller) filterOptions.isBestSeller = true;

    // --- Sorting --- 
    let sortOptions = {};
    const sortBy = req.query.sort;
    if (sortBy === 'price-asc') sortOptions = { price: 1 };
    else if (sortBy === 'price-desc') sortOptions = { price: -1 };
    // Add default sort if needed, e.g., { name: 1 }

    // --- Aggregation Pipeline --- 
    const pipeline = [
        // Stage 1: Match products based on filters
        { $match: filterOptions }, 
        
        // Stage 2: Lookup feedback for each product
        {
            $lookup: {
                from: Feedback.collection.name, // Use the collection name
                localField: '_id', // Field from the products collection
                foreignField: 'product', // Field from the feedback collection
                as: 'reviews' // Output array field name
            }
        },
        
        // Stage 3: Add fields for average rating and number of reviews
        {
            $addFields: {
                numReviews: { $size: '$reviews' },
                averageRating: { $avg: '$reviews.rating' } // Calculate average of the rating field in the reviews array
            }
        },
        
        // Stage 4: Project to keep original fields and add new ones (optional: remove reviews array)
        {
            $project: {
                reviews: 0 // Exclude the reviews array from the final output
            }
        },
        
        // Stage 5: Sort the results
        { $sort: Object.keys(sortOptions).length > 0 ? sortOptions : { _id: 1 } } // Apply sort, default if none specified
    ];

    // Execute aggregation pipeline
    const products = await Product.aggregate(pipeline);

    // Get total count separately (aggregation doesn't easily provide count with sorting/filtering like this)
    const totalCount = await Product.countDocuments(filterOptions);
    
    res.json({ 
        products: products, 
        totalCount: totalCount 
    });
    
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ message: 'Error fetching products' });
  }
});

// GET product by ID
app.get('/api/products/:id', async (req, res) => {
  try {
    const productId = req.params.id;
    // Check if the ID is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ message: 'Invalid product ID format' });
    }
    
    // --- Aggregation Pipeline for single product ---
    const pipeline = [
        // Stage 1: Match the specific product ID
        { $match: { _id: new mongoose.Types.ObjectId(productId) } }, 
        
        // Stage 2: Lookup feedback
        {
            $lookup: {
                from: Feedback.collection.name,
                localField: '_id',
                foreignField: 'product',
                as: 'reviews'
            }
        },
        
        // Stage 3: Add average rating and review count
        {
            $addFields: {
                numReviews: { $size: '$reviews' },
                averageRating: { $avg: '$reviews.rating' }
            }
        },
        
        // Stage 4: Project to exclude reviews array
        {
            $project: {
                reviews: 0
            }
        }
    ];
    
    const productResult = await Product.aggregate(pipeline);
    
    if (!productResult || productResult.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    // Aggregation returns an array, take the first element
    res.json(productResult[0]); 
    
  } catch (err) {
     console.error("Error fetching product by ID:", err);
     res.status(500).json({ message: 'Error fetching product' });
  }
});

// API endpoint for searching products
app.get('/api/search', async (req, res) => {
  const query = req.query.q; // Get the search query from query params
  console.log(`[Search API] Received search query: '${query}'`);

  if (!query) {
    console.log("[Search API] Query is empty, returning 400.");
    return res.status(400).json({ message: 'Search query cannot be empty' });
  }

  try {
    // Use a case-insensitive regex to search in the 'name' field
    const products = await Product.find({
      name: { $regex: query, $options: 'i' } // 'i' for case-insensitive
    });
    console.log(`[Search API] Found ${products.length} products matching query.`);

    if (!products || products.length === 0) {
      console.log("[Search API] No products found, returning 404.");
      return res.status(404).json({ message: 'No products found matching your search.' });
    }

    // Return only the product data (no totalCount needed here typically)
    res.json(products); 

  } catch (err) {
    console.error("[Search API] Error during product search:", err);
    res.status(500).json({ message: 'Error searching products' });
  }
});

// POST a new product (Example)
app.post('/api/products', async (req, res) => {
  try {
    const newProduct = new Product(req.body);
    const savedProduct = await newProduct.save();
    res.status(201).json(savedProduct);
  } catch (err) {
    console.error("Error creating product:", err);
    // Add more specific error handling (e.g., validation errors)
    res.status(400).json({ message: 'Error creating product' }); 
  }
});

// --- Authentication Routes ---

// Register a new user
app.post('/api/auth/register', async (req, res) => {
  console.log("[Register Route] Received request"); // Log route entry
  const { firstName, lastName, username, email, password } = req.body; // Add firstName, lastName
  console.log("[Register Route] Received data:", { firstName, lastName, username, email, password: password ? '[PRESENT]' : '[MISSING]' }); // Log received data (hide actual password)

  // Validate input
  if (!firstName || !lastName || !username || !email || !password) { // Added firstName, lastName check
    console.log("[Register Route] Failed: Missing required fields"); // Log failure
    return res.status(400).json({ message: 'All fields are required' }); // Updated message
  }
  // Add more validation (e.g., password length, username format) if needed
  
  // --- Password Complexity Rules ---
  console.log("[Register Route] Checking password length..."); // Log check start
  if (password.length < 8) {
    console.log("[Register Route] Failed: Password too short"); // Log failure
    return res.status(400).json({ message: 'Password must be at least 8 characters long' });
  }
  console.log("[Register Route] Checking password uppercase..."); // Log check start
  if (!/[A-Z]/.test(password)) {
    console.log("[Register Route] Failed: No uppercase letter"); // Log failure
    return res.status(400).json({ message: 'Password must contain at least one uppercase letter' });
  }
  // Add check for lowercase if needed: if (!/[a-z]/.test(password)) ...
  // Add check for number if needed: if (!/[0-9]/.test(password)) ...
  console.log("[Register Route] Checking password special char..."); // Log check start
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]/.test(password)) { // Adjusted regex for common specials
    console.log("[Register Route] Failed: No special character"); // Log failure
    return res.status(400).json({ message: 'Password must contain at least one special character' });
  }
  console.log("[Register Route] Password validation passed."); // Log success
  // --- End Password Complexity Rules ---

  try {
    console.log("[Register Route] Entering TRY block to check existing user..."); // Log entering try
    // Check if username or email already exists
    const existingUser = await User.findOne({ 
        $or: [ { email: email.toLowerCase() }, { username: username.toLowerCase() } ] 
    });
    if (existingUser) {
        let message = 'Registration failed.';
        if (existingUser.email === email.toLowerCase()) {
            message = 'Email already in use';
        } else if (existingUser.username === username.toLowerCase()) {
            message = 'Username already taken';
        }
      return res.status(400).json({ message: message });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10); 
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create and save user
    const newUser = new User({ 
        firstName, // Added
        lastName,  // Added
        username: username.toLowerCase(), // Save username
        email: email.toLowerCase(), 
        password: hashedPassword 
    });
    const savedUser = await newUser.save();

    // --- Auto-login: Generate JWT --- 
    const payload = {
      user: {
        id: savedUser.id 
      }
    };

    jwt.sign(
      payload,
      JWT_SECRET,
      { expiresIn: '1h' }, 
      (err, token) => {
        if (err) {
             console.error("Token signing error after registration:", err);
             // Still send success for registration, but maybe indicate token issue
             return res.status(201).json({ 
                 message: 'User registered successfully, but token generation failed.', 
                 userId: savedUser._id 
             });
        }
        // Send token back for auto-login
        res.status(201).json({ 
            message: 'User registered successfully', 
            userId: savedUser._id, 
            token: token // Include token
        }); 
      }
    );

  } catch (err) {
    console.error("Registration Error:", err);
    // Check for specific Mongoose duplicate key errors if needed
    res.status(500).json({ message: 'Error registering user' });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  const { identifier, password } = req.body; // Use identifier instead of email

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Email/Username and password are required' });
  }

  try {
    // Find user by email or username
    const user = await User.findOne({ 
      $or: [ 
        { email: identifier.toLowerCase() }, 
        { username: identifier.toLowerCase() } 
      ]
     });
     
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // User matched, create JWT payload
    const payload = {
      user: {
        id: user.id 
      }
    };

    // Sign the token
    jwt.sign(
      payload,
      JWT_SECRET,
      { expiresIn: '1h' }, 
      (err, token) => {
        if (err) throw err;
        res.json({ token });
      }
    );

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// --- End Authentication Routes ---

// --- User Data Route (Protected) ---
app.get('/api/users/me', authMiddleware, async (req, res) => {
  try {
    // req.user was attached by authMiddleware
    const user = await User.findById(req.user.id).select('-password'); // Find user by ID from token, exclude password
    if (!user) {
      return res.status(404).json({ message: 'User not found'});
    }
    res.json(user); // Send user data (without password)
  } catch (err) {
    console.error("Error fetching user data:", err);
    res.status(500).json({ message: 'Server error fetching user data' });
  }
});

// --- Wishlist Routes (Protected) ---

// GET user's wishlist
app.get('/api/users/me/wishlist', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('wishlist');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user.wishlist); // Return only the array of product IDs
  } catch (err) {
    console.error("Error fetching user wishlist:", err);
    res.status(500).json({ message: 'Server error fetching wishlist' });
  }
});

// Add item to wishlist
app.post('/api/users/me/wishlist', authMiddleware, async (req, res) => {
  const { productId } = req.body;

  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return res.status(400).json({ message: 'Valid Product ID is required' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Add to set to prevent duplicates
    await user.updateOne({ $addToSet: { wishlist: productId } });

    res.status(200).json({ message: 'Product added to wishlist' });

  } catch (err) {
    console.error("Error adding to wishlist:", err);
    res.status(500).json({ message: 'Server error adding to wishlist' });
  }
});

// Remove item from wishlist
app.delete('/api/users/me/wishlist/:productId', authMiddleware, async (req, res) => {
  const { productId } = req.params;

  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return res.status(400).json({ message: 'Valid Product ID is required' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Pull (remove) the item from the array
    await user.updateOne({ $pull: { wishlist: productId } });

    res.status(200).json({ message: 'Product removed from wishlist' });

  } catch (err) {
    console.error("Error removing from wishlist:", err);
    res.status(500).json({ message: 'Server error removing from wishlist' });
  }
});

// --- End Wishlist Routes ---

// --- Loyalty Points API Endpoint ---
app.get('/api/users/me/loyalty', authMiddleware, async (req, res) => {
    try {
        // User is already fetched and attached by authMiddleware
        const user = await User.findById(req.user.id).select('loyaltyPoints'); // Select only needed field
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ loyaltyPoints: user.loyaltyPoints });
    } catch (error) {
        console.error("Error fetching loyalty points:", error);
        res.status(500).json({ message: 'Error fetching loyalty points' });
    }
});

// --- Checkout Route (Protected) ---
app.post('/api/checkout', authMiddleware, async (req, res) => {
  console.log("[Checkout Route] Received request");
  const { cart, shippingAddress, appliedPromoCode } = req.body; // Add appliedPromoCode
  const userId = req.user.id;

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
      console.log("[Checkout Route] Failed: Cart data missing or empty");
      return res.status(400).json({ message: 'Shopping cart is empty or invalid.' });
  }
  // Basic validation for shipping address
  if (!shippingAddress || !shippingAddress.fullName || !shippingAddress.streetAddress || !shippingAddress.city || !shippingAddress.state || !shippingAddress.postalCode || !shippingAddress.country) {
      console.log("[Checkout Route] Failed: Shipping address missing required fields");
      return res.status(400).json({ message: 'Shipping address is missing required fields.' });
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
             const user = await User.findById(userId).select('loyaltyPoints').session(session);
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
                 const orderCount = await Order.countDocuments({ user: userId }).session(session);
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
        user: userId, 
        items: orderItems,
        subTotal: subTotal, // Store subtotal
        appliedPromoCode: validatedPromoCode, // Store validated code or null
        discountAmount: discountAmount, // Store discount amount
        totalAmount: finalTotal, // Store final amount
        shippingAddress: shippingAddress 
    });

    await newOrder.save({ session });
    console.log(`[Checkout Route] Order ${newOrder._id} created for user ${userId}`);

    // --- Award Loyalty Points (Based on FINAL amount paid) --- 
    const pointsEarned = Math.floor(finalTotal); // Base points on the final discounted amount
    console.log(`[Checkout Route] Awarding ${pointsEarned} loyalty points to user ${userId}`);
    await User.findByIdAndUpdate(userId, 
        { $inc: { loyaltyPoints: pointsEarned } }, 
        { session } 
    );
    console.log(`[Checkout Route] Loyalty points updated for user ${userId}`);
    
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

// --- Get User Orders Route (Protected) ---
app.get('/api/users/me/orders', authMiddleware, async (req, res) => {
  console.log("[Get Orders Route] Received request for user:", req.user.id);
  try {
    // Find orders for the current user, sort by newest first
    // Populate the product details for each item, specifically selecting the image
    const orders = await Order.find({ userId: req.user.id })
                             .sort({ orderDate: -1 })
                             .populate({
                                path: 'items.productId',
                                select: 'image' // Only fetch the image field from the Product
                             });

    if (!orders) {
      // This case might not happen with find, returns [] instead, but good practice
      return res.status(404).json({ message: 'No orders found for this user.' });
    }

    console.log(`[Get Orders Route] Found ${orders.length} orders for user ${req.user.id}`);
    res.json(orders); // Send the array of orders

  } catch (error) {
    console.error("[Get Orders Route] Error fetching orders:", error);
    res.status(500).json({ message: 'Failed to fetch orders.' });
  }
});

// --- Transaction History API Endpoint ---
app.get('/api/users/me/orders', authMiddleware, async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user.id })
            .sort({ orderDate: -1 }) // Sort by most recent first
            .populate('items.product', 'name image'); // Optionally populate some product details
            
        res.json(orders);
    } catch (error) {
        console.error("Error fetching orders:", error);
        res.status(500).json({ message: 'Error fetching orders' });
    }
});

// --- Feedback API Endpoint ---
app.post('/api/feedback', authMiddleware, async (req, res) => {
    const { productId, rating, comment } = req.body;
    const userId = req.user.id;

    // Basic validation
    if (!comment) {
        return res.status(400).json({ message: 'Comment is required.' });
    }
    if (rating && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
        return res.status(400).json({ message: 'Rating must be a number between 1 and 5.' });
    }
    if (productId && !mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ message: 'Invalid Product ID format.' });
    }

    try {
        const newFeedback = new Feedback({
            user: userId,
            product: productId || null, // Store null if no productId provided
            rating: rating || null,     // Store null if no rating provided
            comment: comment
        });

        await newFeedback.save();

        res.status(201).json({ message: 'Feedback submitted successfully!', feedbackId: newFeedback._id });

    } catch (error) {
        console.error("Error submitting feedback:", error);
        res.status(500).json({ message: 'Failed to submit feedback.' });
    }
});

// --- Get Applicable Promotions Endpoint ---
app.get('/api/users/me/promotions', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    try {
        // Fetch user data (points and maybe registration date for welcome offer)
        const user = await User.findById(userId).select('loyaltyPoints createdAt');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Define loyalty tiers (could be moved to config)
        const tiers = {
            Bronze: 0,
            Silver: 100,
            Gold: 500
        };
        let userTier = 'Bronze';
        if (user.loyaltyPoints >= tiers.Gold) userTier = 'Gold';
        else if (user.loyaltyPoints >= tiers.Silver) userTier = 'Silver';

        // Fetch active promotions
        const now = new Date();
        const activePromotions = await Promotion.find({
            isActive: true,
            $or: [
                { startDate: { $exists: false } },
                { startDate: { $lte: now } }
            ],
            $or: [
                { endDate: { $exists: false } },
                { endDate: { $gte: now } }
            ]
            // Add check for maxUses if needed: { $expr: { $lt: [ "$usageCount", "$maxUses" ] } } 
        });

        // Filter promotions based on user eligibility
        const eligiblePromotions = activePromotions.filter(promo => {
            // 1. General promotions (no tier specified)
            if (!promo.applicableTier) return true;
            
            // 2. Welcome offer (simplistic: check if code is WELCOME10 and user hasn't used it - needs usage tracking later)
            // For now, let's assume welcome offers are always shown if active
            if (promo.code === 'WELCOME10') return true; // Needs refinement with usage tracking

            // 3. Loyalty tier promotions
            if (promo.applicableTier === 'Silver' && user.loyaltyPoints >= tiers.Silver) return true;
            if (promo.applicableTier === 'Gold' && user.loyaltyPoints >= tiers.Gold) return true;

            return false; // Not eligible for other tier-specific promos
        });
        
        // TODO: Add filtering based on user's past usage of single-use codes

        res.json(eligiblePromotions); // Return codes, descriptions etc.

    } catch (error) {
        console.error("Error fetching promotions:", error);
        res.status(500).json({ message: 'Failed to fetch promotions.' });
    }
});

// --- Apply Promotion Code Endpoint ---
app.post('/api/apply-promotion', authMiddleware, async (req, res) => {
    const { code } = req.body;
    const userId = req.user.id;

    if (!code) {
        return res.status(400).json({ message: 'Promotion code is required.' });
    }

    try {
        const promoCode = code.toUpperCase().trim();
        const promotion = await Promotion.findOne({ code: promoCode });

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
        const user = await User.findById(userId).select('loyaltyPoints createdAt orders'); // Fetch orders for usage check
        if (!user) {
             return res.status(404).json({ message: 'User not found.' }); // Should not happen if authMiddleware works
        }
        
        // Check loyalty tier
        if (promotion.applicableTier) {
             const tiers = { Bronze: 0, Silver: 100, Gold: 500 }; // Keep consistent with GET endpoint
             let userTierMet = false;
             if (promotion.applicableTier === 'Silver' && user.loyaltyPoints >= tiers.Silver) userTierMet = true;
             if (promotion.applicableTier === 'Gold' && user.loyaltyPoints >= tiers.Gold) userTierMet = true;
             // Add Bronze check if needed
             if (!userTierMet) {
                 return res.status(403).json({ message: `You need ${promotion.applicableTier} tier for this promotion.` });
             }
        }

        // Check max uses per user (requires querying past orders)
        // TODO: Implement a more robust usage tracking system if needed 
        // (e.g., store used codes in User schema or query Orders)
        // For now, let's assume simple maxUsesPerUser check is sufficient *if* we track it on Order
        if (promotion.maxUsesPerUser === 1 && promotion.code === 'WELCOME10') {
             // Basic check: Has the user placed ANY order before? 
             const orderCount = await Order.countDocuments({ user: userId });
             if (orderCount > 0) {
                 return res.status(403).json({ message: 'Welcome offer is only for your first order.' });
             }
        }
         // Add checks for other single-use codes if necessary by querying Orders

        // --- Validation Passed --- 
        res.json({
            message: 'Promotion applied successfully!',
            code: promotion.code,
            description: promotion.description,
            discountType: promotion.discountType,
            discountValue: promotion.discountValue
        });

    } catch (error) {
        console.error("Error applying promotion code:", error);
        res.status(500).json({ message: 'Failed to apply promotion code.' });
    }
});

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