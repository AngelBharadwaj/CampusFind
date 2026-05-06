import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { sendOTPEmail } from './emailConfig.js';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// === JWT Secret ===
const JWT_SECRET = process.env.JWT_SECRET || 'fhfhidufisdkjflksdn';

// === Setup for ES Modules and __dirname ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// === MongoDB Connection ===
mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campusfind', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// === OTP Schema ===
const otpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true }
});
const OTP = mongoose.model('OTP', otpSchema);

// === UPDATED: Item Schema with status field ===
const itemSchema = new mongoose.Schema({
  usn: { type: String, required: true },
  phone: { type: String, required: true },
  itemName: { type: String, required: true },
  imageUrl: { type: String },
  email: { type: String },
  submittedLocation: { type: String },
  status: { 
    type: String, 
    enum: ['pending_receipt', 'available', 'claimed'], 
    default: 'pending_receipt' 
  },
  createdAt: { type: Date, default: Date.now },
  receiptConfirmedAt: { type: Date }
});
const Item = mongoose.model('Item', itemSchema);

// === Claim Schema ===
const claimSchema = new mongoose.Schema({
  usn: { type: String, required: true },
  phone: { type: String, required: true },
  itemName: { type: String, required: true },
  specifications: { type: String, required: true },
  claimed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Claim = mongoose.model('Claim', claimSchema);

// === UPDATED: History Schema with new status options ===
const historySchema = new mongoose.Schema({
  usn: { type: String, required: true },
  phone: { type: String, required: true },
  itemName: { type: String, required: true },
  specifications: { type: String },
  status: { 
    type: String, 
    enum: ['returned_to_owner', 'rejected'], 
    default: 'returned_to_owner' 
  },
  verifiedAt: { type: Date, default: Date.now },
});
const History = mongoose.model('History', historySchema);

// === User Schema ===
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student', 'faculty'], required: true },
  verified: { type: Boolean, default: false }
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

const User = mongoose.model('User', userSchema);

// === Multer Config ===
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// === Helper Functions ===
function validateFacultyEmail(email) {
  return email.toLowerCase().endsWith('@campusfind.com');
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// === Validation Functions ===
function validateUSN(usn) {
  const usnRegex = /^4GW[a-zA-Z0-9]{7}$/;
  return usnRegex.test(usn);
}

function validatePhone(phone) {
  const phoneRegex = /^[0-9]{10}$/;
  return phoneRegex.test(phone);
}

// === Routes ===

// Test Route
app.get('/', (req, res) => {
  res.json({ message: 'CampusFind API is running 🚀' });
});

// Health check route
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
  res.json({ 
    message: 'Server is running', 
    database: dbStatus,
    emailConfigured: true,
    otpEmail: process.env.EMAIL_USER,
    timestamp: new Date().toISOString()
  });
});

// Send OTP (for students only)
app.post('/api/send-otp', async (req, res) => {
  const { email, role } = req.body;

  if (!email || !role) {
    return res.status(400).json({ message: 'Email and role are required' });
  }

  if (role !== 'student') {
    return res.status(400).json({ message: 'OTP is only required for student registration' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Invalid email. OTP cannot be sent.' });
  }

  // Check if trying to use campusfind.com email for student
  if (validateFacultyEmail(email)) {
    return res.status(400).json({ message: 'Student registration is not allowed with @campusfind.com emails' });
  }

  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    return res.status(400).json({ message: 'Email already exists' });
  }

  try {
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OTP.deleteMany({ email: email.toLowerCase() });

    const newOTP = new OTP({
      email: email.toLowerCase(),
      otp,
      expiresAt
    });
    await newOTP.save();

    console.log(`📧 OTP generated for ${email}: ${otp}`);

    const emailSent = await sendOTPEmail(email, otp);
    
    if (emailSent) {
      res.status(200).json({ message: 'OTP sent successfully to your email address' });
    } else {
      // Even if email fails, we'll still allow testing by showing OTP in response
      res.status(200).json({ 
        message: 'OTP generated successfully', 
        otp: otp, // Sending OTP in response for testing
        note: 'Email delivery failed. Use this OTP for testing.' 
      });
    }
  } catch (err) {
    console.error('Error sending OTP:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Verify OTP
app.post('/api/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  console.log(`🔐 OTP verification attempt for ${email}: ${otp}`);

  if (!email || !otp) {
    return res.status(400).json({ message: 'Email and OTP are required' });
  }

  try {
    const otpRecord = await OTP.findOne({ 
      email: email.toLowerCase(), 
      otp 
    });

    if (!otpRecord) {
      console.log('❌ OTP not found in database');
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    if (otpRecord.expiresAt < new Date()) {
      await OTP.deleteOne({ _id: otpRecord._id });
      console.log('❌ OTP expired');
      return res.status(400).json({ message: 'OTP has expired' });
    }

    // Mark OTP as verified but don't delete it yet
    // We'll delete it during registration
    console.log('✅ OTP verified successfully');
    res.status(200).json({ message: 'OTP verified successfully' });

  } catch (err) {
    console.error('Error verifying OTP:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Register User
app.post('/api/register', async (req, res) => {
  const { email, password, role, otp } = req.body;
  
  console.log(`👤 Registration attempt for: ${email}, role: ${role}`);
  
  if (!email || !password || !role) {
    return res.status(400).json({ message: 'Email, password, and role are required' });
  }

  try {
    if (role === 'faculty' && !validateFacultyEmail(email)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    if (role === 'student' && validateFacultyEmail(email)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    // For students, verify OTP exists and is valid
    if (role === 'student') {
      if (!otp) {
        return res.status(400).json({ message: 'OTP is required for student registration' });
      }

      const otpRecord = await OTP.findOne({ 
        email: email.toLowerCase(), 
        otp 
      });

      if (!otpRecord) {
        console.log('❌ OTP not found during registration');
        return res.status(400).json({ message: 'Invalid OTP. Please verify OTP first.' });
      }

      if (otpRecord.expiresAt < new Date()) {
        await OTP.deleteOne({ _id: otpRecord._id });
        return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
      }

      // Delete OTP after successful verification during registration
      await OTP.deleteOne({ _id: otpRecord._id });
      console.log('✅ OTP verified and deleted during registration');
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const user = new User({ 
      email: email.toLowerCase(), 
      password, 
      role,
      verified: role === 'student'
    });
    await user.save();

    console.log(`✅ User registered successfully: ${email}`);

    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    res.status(201).json({
      message: '✅ User registered successfully',
      token,
      role: user.role,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login User
app.post('/login', async (req, res) => {
  try {
    let { email, password, role } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ message: 'Email, password, and role are required' });
    }

    if (role === 'faculty' && !validateFacultyEmail(email)) {
      return res.status(401).json({ message: 'Invalid role' });
    }

    if (role === 'student' && validateFacultyEmail(email)) {
      return res.status(401).json({ message: 'Invalid role' });
    }

    email = email.toLowerCase();
    const user = await User.findOne({ email, role });
    if (!user) {
      return res.status(401).json({ message: 'Invalid role' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, role: user.role });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// === UPDATED: Submit Lost Item - Now sets status to 'pending_receipt' ===
app.post('/api/submit-item', upload.single('image'), async (req, res) => {
  try {
    const { usn, phone, itemName, submittedLocation } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    // Validate USN format
    if (!validateUSN(usn)) {
      return res.status(400).json({ message: 'Invalid USN format. Must start with 4GW followed by 7 characters.' });
    }

    // Validate phone number
    if (!validatePhone(phone)) {
      return res.status(400).json({ message: 'Invalid phone number. Must be exactly 10 digits.' });
    }

    if (!usn || !phone || !itemName || !submittedLocation) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const newItem = new Item({
      usn: usn.toUpperCase(),
      phone,
      itemName,
      imageUrl,
      submittedLocation,
      status: 'pending_receipt' // New items start as pending receipt
    });

    await newItem.save();
    res.status(201).json({ 
      message: 'Item submitted successfully! It will appear in student dashboard after faculty verification.', 
      item: newItem 
    });
  } catch (error) {
    console.error('Error submitting item:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// === UPDATED: Submit Lost Item (Alternative endpoint) ===
app.post('/api/items', upload.single('image'), async (req, res) => {
  try {
    const { usn, phone, itemName, submittedLocation } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    // Validate USN format
    if (!validateUSN(usn)) {
      return res.status(400).json({ message: 'Invalid USN format. Must start with 4GW followed by 7 characters.' });
    }

    // Validate phone number
    if (!validatePhone(phone)) {
      return res.status(400).json({ message: 'Invalid phone number. Must be exactly 10 digits.' });
    }

    if (!usn || !phone || !itemName || !submittedLocation) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const newItem = new Item({
      usn: usn.toUpperCase(),
      phone,
      itemName,
      imageUrl,
      submittedLocation,
      status: 'pending_receipt' // New items start as pending receipt
    });

    await newItem.save();
    res.status(201).json({ 
      message: 'Item submitted successfully! It will appear in student dashboard after faculty verification.', 
      item: newItem 
    });
  } catch (error) {
    console.error('Error submitting item:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// === NEW: Get items pending receipt confirmation ===
app.get('/api/items/pending-receipt', async (req, res) => {
  try {
    const items = await Item.find({ status: 'pending_receipt' }).sort({ createdAt: -1 });
    res.json(items);
  } catch (error) {
    console.error('Error fetching pending receipt items:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// === NEW: Get available items (for student dashboard) ===
app.get('/api/items/available', async (req, res) => {
  try {
    const items = await Item.find({ status: 'available' }).sort({ receiptConfirmedAt: -1 });
    res.json(items);
  } catch (error) {
    console.error('Error fetching available items:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// === NEW: Confirm receipt of item by faculty ===
app.post('/api/confirm-receipt', async (req, res) => {
  try {
    const { itemId } = req.body;

    if (!itemId) {
      return res.status(400).json({ message: 'Item ID is required' });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    if (item.status !== 'pending_receipt') {
      return res.status(400).json({ message: 'Item is not pending receipt' });
    }

    // Update item status to available and set confirmation timestamp
    item.status = 'available';
    item.receiptConfirmedAt = new Date();
    await item.save();

    res.json({ 
      message: 'Item receipt confirmed successfully. Item is now available for claiming.', 
      item 
    });
  } catch (error) {
    console.error('Error confirming receipt:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// === UPDATED: Get all items (for faculty - includes all statuses) ===
app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// === UPDATED: Get Lost Items for Student Dashboard (only available items) ===
app.get('/api/lost-items', async (req, res) => {
  try {
    const items = await Item.find({ status: 'available' }).sort({ receiptConfirmedAt: -1 });
    res.json(items);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Claim Item
app.post('/api/claim-item', async (req, res) => {
  try {
    const { usn, phone, itemName, specifications } = req.body;

    // Validate USN format
    if (!validateUSN(usn)) {
      return res.status(400).json({ message: 'Invalid USN format. Must start with 4GW followed by 7 characters.' });
    }

    // Validate phone number
    if (!validatePhone(phone)) {
      return res.status(400).json({ message: 'Invalid phone number. Must be exactly 10 digits.' });
    }

    if (!usn || !phone || !itemName || !specifications) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Check if item exists and is available
    const item = await Item.findOne({ itemName, status: 'available' });
    if (!item) {
      return res.status(404).json({ message: 'Item not found or not available for claiming' });
    }

    const newClaim = new Claim({
      usn: usn.toUpperCase(),
      phone,
      itemName,
      specifications
    });

    await newClaim.save();
    res.status(201).json({ message: 'Item claimed successfully', claim: newClaim });
  } catch (error) {
    console.error('Error claiming item:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Claim Item (Alternative endpoint for frontend compatibility)
app.post('/api/claim', async (req, res) => {
  try {
    const { usn, phone, itemName, specifications } = req.body;

    // Validate USN format
    if (!validateUSN(usn)) {
      return res.status(400).json({ message: 'Invalid USN format. Must start with 4GW followed by 7 characters.' });
    }

    // Validate phone number
    if (!validatePhone(phone)) {
      return res.status(400).json({ message: 'Invalid phone number. Must be exactly 10 digits.' });
    }

    if (!usn || !phone || !itemName || !specifications) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Check if item exists and is available
    const item = await Item.findOne({ itemName, status: 'available' });
    if (!item) {
      return res.status(404).json({ message: 'Item not found or not available for claiming' });
    }

    const newClaim = new Claim({
      usn: usn.toUpperCase(),
      phone,
      itemName,
      specifications
    });

    await newClaim.save();
    res.status(201).json({ message: 'Item claimed successfully', claim: newClaim });
  } catch (error) {
    console.error('Error claiming item:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get Claims for Faculty Panel
app.get('/api/claims', async (req, res) => {
  try {
    const claims = await Claim.find().sort({ createdAt: -1 });
    res.json(claims);
  } catch (error) {
    console.error('Error fetching claims:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get Pending Claims for Faculty Panel
app.get('/api/claims/pending', async (req, res) => {
  try {
    const claims = await Claim.find({ claimed: false }).sort({ createdAt: -1 });
    res.json(claims);
  } catch (error) {
    console.error('Error fetching claims:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// === UPDATED: Reject Claim endpoint ===
app.post('/api/reject-claim', async (req, res) => {
  try {
    const { claimId, itemName, status } = req.body;

    if (!claimId || !itemName) {
      return res.status(400).json({ message: 'Claim ID and item name are required' });
    }

    const claim = await Claim.findById(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    // Move to history with rejected status
    const historyItem = new History({
      usn: claim.usn,
      phone: claim.phone,
      itemName: claim.itemName,
      specifications: claim.specifications,
      status: 'rejected'
    });

    await historyItem.save();

    // Remove from claims but keep the item in lost items for others to claim
    await Claim.findByIdAndDelete(claimId);

    res.json({ 
      message: 'Claim rejected and moved to history', 
      history: historyItem
    });
  } catch (error) {
    console.error('Error rejecting claim:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// === UPDATED: Return to Owner endpoint (replaces verify-claim) ===
app.post('/api/return-to-owner', async (req, res) => {
  try {
    const { claimId, itemName, status } = req.body;

    if (!claimId || !itemName) {
      return res.status(400).json({ message: 'Claim ID and item name are required' });
    }

    const claim = await Claim.findById(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    // Move to history with returned_to_owner status
    const historyItem = new History({
      usn: claim.usn,
      phone: claim.phone,
      itemName: claim.itemName,
      specifications: claim.specifications,
      status: 'returned_to_owner'
    });

    await historyItem.save();

    // Delete the corresponding lost item and all claims for this item
    await Item.findOneAndDelete({ itemName: itemName });
    await Claim.deleteMany({ itemName: itemName });

    res.json({ 
      message: 'Item returned to owner successfully. Item and all related claims removed.', 
      history: historyItem
    });
  } catch (error) {
    console.error('Error returning item to owner:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// === Keep old verify-claim endpoint for backward compatibility ===
app.post('/api/verify-claim', async (req, res) => {
  try {
    const { claimId, itemName, status } = req.body;

    if (!claimId || !itemName) {
      return res.status(400).json({ message: 'Claim ID and item name are required' });
    }

    const claim = await Claim.findById(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    // Move to history with returned_to_owner status
    const historyItem = new History({
      usn: claim.usn,
      phone: claim.phone,
      itemName: claim.itemName,
      specifications: claim.specifications,
      status: 'returned_to_owner'
    });

    await historyItem.save();

    // Delete the corresponding lost item and all claims for this item
    await Item.findOneAndDelete({ itemName: itemName });
    await Claim.deleteMany({ itemName: itemName });

    res.json({ 
      message: 'Item returned to owner successfully. Item and all related claims removed.', 
      history: historyItem
    });
  } catch (error) {
    console.error('Error verifying claim:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get History
app.get('/api/history', async (req, res) => {
  try {
    const history = await History.find().sort({ verifiedAt: -1 });
    res.json(history);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
// === Start Server ===
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 API Base URL: http://localhost:${PORT}`);
  console.log(`📧 OTP Emails configured from: "CampusFind" <${process.env.EMAIL_USER}>`);
  console.log(`🔄 Server ready!`);
}).on('error', (err) => {
  console.error('❌ Server failed to start:', err);
});