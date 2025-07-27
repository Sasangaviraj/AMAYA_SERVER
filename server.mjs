import express, { json } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { productTeaData } from './data/data.mjs';
import admin from 'firebase-admin';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const serviceAccount = require('./serviceAccountKey.json');


// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const server = express();
dotenv.config();

server.use(cors({
    origin: "http://localhost:5173"
}));
server.use(json());

// Connect to MongoDB
const connectDB = async () => {
    try {
        console.log('Attempting to connect to MongoDB with URI:', process.env.MONGO_URI ? '***** (URI present)' : 'ERROR: MONGO_URI not found in .env');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected successfully!');
    } catch (error) {
        console.error('MongoDB connection failed:', error.message);
        process.exit(1);
    }
};

// --- Mongoose Schemas and Models ---

// Product schema and model (UPDATED to include new fields)
const productSchema = new mongoose.Schema({
    imageUrl: { type: String, required: true },
    productName: { type: String, required: true },
    productPrice: { type: String, required: true },
    productId: { type: String, required: true, unique: true },
    key: { type: String, required: true, unique: true },
    description: { type: String },
    notes: [{ type: String }],
    availableSizes: [{ type: String }],
    availableRoasts: [{ type: String }],
    harvest: { type: String }, // NEW
    country: { type: String }, // NEW
    region: { type: String }, // NEW
    altitude: { type: String },// NEW
    category: { type: String },
});
const Product = mongoose.model('Product', productSchema, 'products');

// Cart Item Schema
const cartItemSchema = new mongoose.Schema({
    productId: { type: String, required: true },
    productName: { type: String, required: true },
    productPrice: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    selectedSize: { type: String },
    selectedRoast: { type: String },
});

// User Cart Schema and Model
const userCartSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    items: [cartItemSchema],
}, { timestamps: true });

const UserCart = mongoose.model('UserCart', userCartSchema, 'userCarts');

// --- Initial Data Import ---
const importData = async () => {
    try {
        const count = await Product.countDocuments();
        if (count === 0) {
            await Product.insertMany(productTeaData);
            console.log('Initial Data Imported Successfully!');
        } else {
            console.log('Database already contains data. Skipping initial import.');
        }
    } catch (error) {
        console.error(`Error importing data: ${error.message}`);
    }
};

// --- Authentication Middleware ---
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.status(401).json({ message: 'Authentication token required.' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Error verifying Firebase ID token:', error.message);
        return res.status(403).json({ message: 'Invalid or expired token.' });
    }
};

// --- API Endpoints ---

// API Endpoint to get ALL Products Data from DB
server.get('/api/v1/shop/', async (req, res) => {
    try {
        const products = await Product.find({});
        res.status(200).json({
            prodata: products
        });
    } catch (error) {
        console.error("Error fetching products from DB:", error.message);
        res.status(500).json({ message: "Server Error fetching products" });
    }
});

// API Endpoint to get a SINGLE Product by ID
server.get('/api/v1/products/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const product = await Product.findOne({ productId: productId });

        if (!product) {
            return res.status(404).json({ message: 'Product not found.' });
        }
        res.status(200).json({ product: product });
    } catch (error) {
        console.error("Error fetching single product:", error.message);
        res.status(500).json({ message: "Server Error fetching product details" });
    }
});

// NEW: API Endpoint to get RELATED Products
server.get('/api/v1/products/:productId/related', async (req, res) => {
    try {
        const { productId } = req.params;
        // Fetch all products, then filter out the current product
        const allProducts = await Product.find({});
        const filteredProducts = allProducts.filter(p => p.productId !== productId);

        // Simple logic: return up to 4 random related products
        const relatedProducts = [];
        const numToSelect = Math.min(4, filteredProducts.length); // Max 4 related products

        // Shuffle the filtered products and pick the first 'numToSelect'
        for (let i = filteredProducts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [filteredProducts[i], filteredProducts[j]] = [filteredProducts[j], filteredProducts[i]];
        }

        for (let i = 0; i < numToSelect; i++) {
            relatedProducts.push(filteredProducts[i]);
        }

        res.status(200).json({ relatedProducts: relatedProducts });
    } catch (error) {
        console.error("Error fetching related products:", error.message);
        res.status(500).json({ message: "Server Error fetching related products" });
    }
});


// Get User Cart (requires authentication)
server.get('/api/v1/cart', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const userCart = await UserCart.findOne({ userId });

        if (!userCart) {
            return res.status(200).json({ items: [] });
        }
        res.status(200).json({ items: userCart.items });
    } catch (error) {
        console.error("Error fetching user cart:", error.message);
        res.status(500).json({ message: "Server Error fetching cart" });
    }
});

// Add/Update Item in Cart (requires authentication) 
server.post('/api/v1/cart/add', authenticateToken, async (req, res) => {
    const userId = req.user.uid;
    const { productId, productName, productPrice, quantity, selectedSize, selectedRoast } = req.body;

    if (!productId || !productName || !productPrice || !quantity || quantity < 1) {
        return res.status(400).json({ message: 'Invalid cart item data. Missing required fields.' });
    }

    try {
        let userCart = await UserCart.findOne({ userId });

        if (!userCart) {
            userCart = new UserCart({ userId, items: [] });
        }

        const existingItemIndex = userCart.items.findIndex(
            item => item.productId === productId &&
                    item.selectedSize === selectedSize &&
                    item.selectedRoast === selectedRoast
        );

        if (existingItemIndex > -1) {
            userCart.items[existingItemIndex].quantity += quantity;
        } else {
            userCart.items.push({ productId, productName, productPrice, quantity, selectedSize, selectedRoast });
        }

        await userCart.save();
        res.status(200).json({ message: 'Item added/updated in cart successfully!', cart: userCart.items });
    } catch (error) {
        console.error("Error adding/updating item in cart:", error.message);
        res.status(500).json({ message: "Server Error adding/updating cart item" });
    }
});

// Remove Item from Cart (requires authentication)
server.delete('/api/v1/cart/remove/:productId', authenticateToken, async (req, res) => {
    const userId = req.user.uid;
    const { productId } = req.params;

    try {
        let userCart = await UserCart.findOne({ userId });

        if (!userCart) {
            return res.status(404).json({ message: 'Cart not found for this user.' });
        }

        userCart.items = userCart.items.filter(item => item.productId !== productId);
        await userCart.save();
        res.status(200).json({ message: 'Item removed from cart successfully!', cart: userCart.items });
    } catch (error) {
        console.error("Error removing item from cart:", error.message);
        res.status(500).json({ message: "Server Error removing cart item" });
    }
});


// Start the server and connect to DB
const PORT = 4000;
server.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    await connectDB();
    // importData(); // Uncomment this line if you want to import initial product data
});
