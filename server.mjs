import express, { json } from 'express'
import cors from 'cors'
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { productTeaData } from './data/data.mjs';



const server = express();
dotenv.config();


server.use(cors({
    origin: "http://localhost:5173"
    })
);
server.use(json())

// connect MongoDb
const connectDB =async ()=>{
    try{
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected successfully!');
    }catch(error){
        console.error('MongoDB connection failed:');
         process.exit(1);
    }
}


// product schema and model
const productSchema = new mongoose.Schema({
    imageUrl:{type:String,required:true},
    productName:{type:String,required:true},
    productPrice:{type:String,required:true},
    productId:{type:String,required:true,unique:true},
    key:{type:String,required:true,unique:true}
})

const Product = mongoose.model('Product',productSchema,'products');

// insert data in DB
const importData = async ()=>{
    try{
        const count = await Product.countDocuments();
            if(count===0){
                await Product.insertMany(productTeaData);
                console.log('Initial Data Imported Successfully!');
            }else{
                console.log('Database already contains data. Skipping initial import.');
            }
        }catch(error){
            console.log(`Error importing data: ${error.message}`);
        }
}

// API Endpoint get Data in DB
server.get('/api/v1/shop/', async(req,res)=>{
    console.log("Request received for /api/v1/shop");
    try{
        const products = await Product.find({});
        res.status(200).json({
            prodata:products
        });

    }catch(error){
        console.log("Error fetching products from DB");
        res.status(500).json({message: "Server Error fetching products"})
    }
})



// connect DB
const PORT = 4000;
server.listen(PORT, async()=>{
    await connectDB();
    // importData();
    console.log(`Server running on http://localhost:${PORT}`);
})