<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>VELUTINX — Membership</title>
  <link rel="stylesheet" href="https://velutinx.com/assets/css/header.css">

  <!-- PayPal SDK – same as pack.html (regular orders, no subscription) -->
  <script src="https://www.paypal.com/sdk/js?client-id=AR7igvBzCZr6spSQ8DswwyQ28fU5U9hY0JwFGHcQmI7NZ5M8kvgPAqqQEN9xPPo5E1UNl-om-OWnscI3&currency=USD" data-sdk-integration-source="button-factory"></script>

  <style>
    /* Keep all existing styles – unchanged, plus new carousel and dropdown styles */
    .container { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
    @media (min-width: 600px) { .container { padding: 0 24px; } }
    main { padding: 40px 0; }
    
    .membership-title {
      font-size: 2.5rem;
      font-weight: 800;
      color: var(--text);
      margin-bottom: 16px;
      text-align: center;
    }
    
    .membership-description {
      color: var(--text);
      text-align: center;
      margin-bottom: 32px;
      font-size: 1.2rem;
    }
    
    /* Carousel layout for tier cards */
    .carousel-container {
      position: relative;
      margin: 40px 0;
    }
    
    .carousel-scroll {
      display: flex;
      overflow-x: auto;
      gap: 2rem;
      padding: 20px 0;
      scroll-behavior: smooth;
      scrollbar-width: none; /* Firefox */
      -ms-overflow-style: none; /* IE/Edge */
    }
    
    .carousel-scroll::-webkit-scrollbar {
      display: none; /* Chrome/Safari */
    }
    
    .tier-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 2rem;
      width: 300px;
      max-width: 100%;
      flex-shrink: 0;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      display: flex;
      flex-direction: column;
      transition: transform 0.2s;
    }
    
    .tier-card:hover {
      transform: translateY(-4px);
    }
    
    .tier-card h3 {
      font-size: 1.8rem;
      margin: 0 0 0.5rem;
      color: var(--text);
    }
    
    .tier-price {
      font-size: 2.2rem;
      font-weight: bold;
      color: var(--accent);
      margin: 0.5rem 0 1rem;
    }
    
    .tier-price span {
      font-size: 1rem;
      font-weight: normal;
      color: var(--text-light);
    }
    
    .tier-perks {
      list-style: none;
      padding: 0;
      margin: 1.5rem 0;
      flex: 1;
    }
    
    .tier-perks li {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border);
      font-size: 1rem;
      line-height: 1.4;
    }
    
    .tier-perks li:last-child {
      border-bottom: none;
    }
    
    .tier-perks li::before {
      content: "✓";
      color: var(--success);
      font-weight: bold;
      font-size: 1.2rem;
      flex-shrink: 0;
    }
    
    /* Two‑button layout */
    .button-row {
      display: flex;
      gap: 10px;
      margin-top: 1.5rem;
    }
    
    .tier-btn {
      flex: 1;
      padding: 10px 0;
      border: none;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: 0.2s;
      color: white;
      text-align: center;
    }
    
    .btn-single {
      background: #3b82f6; /* blue */
    }
    .btn-single:hover {
      background: #2563eb;
    }
    
    .btn-recurring {
      background: #10b981; /* green */
    }
    .btn-recurring:hover {
      background: #059669;
    }
    
    /* Remove from cart button */
    .btn-remove {
      background: #ef4444 !important;
    }
    .btn-remove:hover {
      background: #dc2626 !important;
    }
    
    /* Carousel arrows */
    .carousel-arrow {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 44px;
      height: 44px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 2;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: 1.8rem;
      font-weight: 400;
      color: var(--text);
      transition: all 0.2s;
      line-height: 1;
    }
    
    .carousel-arrow:hover {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    
    .arrow-left {
      left: -20px;
    }
    
    .arrow-right {
      right: -20px;
    }
    
    @media (max-width: 700px) {
      .arrow-left { left: -10px; }
      .arrow-right { right: -10px; }
    }
    
    /* Discord section */
    .discord-section {
      max-width: 600px;
      margin: 0 auto 40px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
    }
    
    .discord-input label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: var(--text);
    }
    
    .discord-input input {
      width: 100%;
      padding: 14px;
      background: var(--bg);
      border: 2px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 1rem;
      transition: border-color 0.2s;
    }
    
    .discord-input input:focus {
      outline: none;
      border-color: var(--accent);
    }
    
    .discord-hint {
      font-size: 0.9rem;
      color: var(--text-light);
      margin-top: 8px;
    }
    
    /* Clickable help link */
    .discord-help-link {
      color: var(--accent);
      cursor: pointer;
      text-decoration: underline;
      font-weight: 500;
      margin-top: 12px;
      display: inline-block;
    }
    
    .discord-help-content {
      display: none;
      margin-top: 16px;
      padding: 16px;
      background: var(--bg);
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    
    .discord-help-content.show {
      display: block;
    }
    
    .discord-help-content p {
      margin-bottom: 12px;
    }
    
    .discord-help-content img {
      max-width: 100%;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    
    .note-box {
      background: rgba(170,158,118,0.1);
      border-left: 4px solid var(--accent);
      padding: 16px;
      margin: 24px 0 0;
      border-radius: 8px;
      font-size: 0.95rem;
    }
    
    #statusMessage {
      text-align: center;
      padding: 12px;
      border-radius: 8px;
      margin: 16px 0;
      display: none;
    }
    
    #statusMessage.success {
      background: rgba(34,197,94,0.2);
      color: var(--success);
      border: 1px solid var(--success);
      display: block;
    }
    
    #statusMessage.error {
      background: rgba(239,68,68,0.2);
      color: #ef4444;
      border: 1px solid #ef4444;
      display: block;
    }
    
    /* Snackbar error variant */
    #snackbar.error {
      background: #ef4444;
    }
  </style>
</head>
<body>
  <div class="lang-swipe" id="langSwipe"></div>
  <nav class="top-nav">
    <div class="logo">VELUTINX</div>
    <div class="nav-actions">
      <button class="login-btn" id="loginBtn" onclick="window.location.href='https://www.velutinx.com/infex'">Website</button>
      <div id="langContainer">
        <button class="nav-icon lang-btn" id="langBtn" title="Language">
          <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 5h7"></path><path d="M7 4c0 4.846 0 7 .5 8"></path><path d="M10 8.5c0 2.286 -2 4.5 -3.5 4.5s-2.5 -1.135 -2.5 -2c0 -2 1 -3 3 -3s5 .57 5 2.857c0 1.524 -.667 2.571 -2 3.143"></path><path d="M12 20l4 -9l4 9"></path><path d="M19.1 18h-6.2"></path>
          </svg>
        </button>
        <div id="languagePopover">
          <div class="lang-item" data-lang="en"><img src="https://flagcdn.com/w40/us.png" alt="US"/><p>English (USD)</p></div>
          <div class="lang-item" data-lang="ja"><img src="https://flagcdn.com/w40/jp.png" alt="JP"/><p>日本語 (円)</p></div>
          <div class="lang-item" data-lang="zh"><img src="https://flagcdn.com/w40/cn.png" alt="CN"/><p>简体中文 (元)</p></div>
          <div class="lang-item" data-lang="es"><img src="https://flagcdn.com/w40/mx.png" alt="MX"/><p>Español (MXN)</p></div>
        </div>
      </div>
      <button class="nav-icon" id="themeBtn">
        <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"></path>
        </svg>
      </button>
      <div class="cart-wrapper">
        <button class="nav-icon cart-icon" id="cartBtn">
          <svg id="cartIcon" xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M6 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path>
            <path d="M17 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path>
            <path d="M17 17h-11v-14h-2"></path>
            <path d="M6 5l14 1l-.86 6.017m-2.64 .983h-10.5"></path>
            <path d="M16 19h6"></path>
            <path d="M19 16v6"></path>
          </svg>
        </button>
        <span class="cart-badge" id="cartCount">0</span>
      </div>
    </div>
  </nav>
  <button class="floating-cart cart-icon" id="floatingCartBtn" title="Shopping Cart">
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path>
      <path d="M17 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path>
      <path d="M17 17h-11v-14h-2"></path>
      <path d="M6 5l14 1l-1 7h-13"></path>
    </svg>
    <span class="floating-badge" id="floatingCartCount">0</span>
  </button>
  <div class="cart-drawer" id="cartDrawer">
    <div class="cart-header">
      <h5 id="cartTitle">Shopping Cart</h5>
      <button class="cart-close" id="cartClose">×</button>
    </div>
    <div class="cart-items" id="cartItems"></div>
    <div class="cart-total">
      <div class="cart-total-row">
        <span id="totalLabel">Total</span>
        <span id="cartTotal">US$0.00</span>
      </div>
      <div id="paypal-button-container"></div>
    </div>
  </div>
  <div id="snackbar">
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
      <path d="M20 6L9 17l-5-5"></path>
    </svg>
    <span id="snackText">Success</span>
  </div>

  <main class="container">
    <h1 class="membership-title">✨ Choose Your Membership</h1>
    <p class="membership-description">Support my work and unlock exclusive perks</p>

    <!-- Shared Discord ID input + help dropdown -->
    <div class="discord-section">
      <div class="discord-input">
        <label for="discordId">Your Discord ID <span style="color:#ef4444;">*</span></label>
        <input type="text" id="discordId" placeholder="e.g., 123456789012345678" required>
        <div class="discord-hint">
          How to find your Discord ID: 
          <span class="discord-help-link" id="discordHelpToggle">Where do I find my Discord ID? (click)</span>
        </div>
      </div>
      <div class="discord-help-content" id="discordHelpContent">
        <p><strong>Step 1:</strong> Open Discord and go to <strong>User Settings</strong> (gear icon).</p>
        <p><strong>Step 2:</strong> Under <strong>App Settings</strong>, select <strong>Advanced</strong> and enable <strong>Developer Mode</strong>.</p>
        <p><strong>Step 3:</strong> Right‑click your username anywhere (e.g., in a server or DM) and select <strong>Copy ID</strong>.</p>
        <p><strong>Step 4:</strong> Paste that number here.</p>
        <img src="https://www.velutinx.com/images/discordID.jpg" alt="Discord ID copy example" style="max-width:100%; border-radius:8px; margin-top:10px;">
      </div>
      <div class="note-box">
        <strong>📌 Important:</strong> After successful payment, you'll receive the corresponding role in our Discord server automatically. Make sure you've joined the server first!
        <div style="margin-top:12px;">
          <a href="https://discord.gg/YOUR_INVITE" target="_blank" style="color:var(--accent); font-weight:600;">→ Join Discord Server ←</a>
        </div>
      </div>
    </div>

    <!-- Carousel with 5 tier cards -->
    <div class="carousel-container">
      <div class="carousel-scroll" id="tierCarousel">
        <!-- Tier 1: Bronze -->
        <div class="tier-card" data-tier="1">
          <h3>✨ Bronze — Archive Access</h3>
          <div class="tier-price">$5 <span>/ month</span></div>
          <ul class="tier-perks">
            <li>Full archive access immediately.</li>
            <li>Includes all past releases & paid content.</li>
          </ul>
          <div class="button-row">
            <button class="tier-btn btn-single" onclick="handleSinglePurchase(1)">Single Purchase</button>
            <button class="tier-btn btn-recurring" onclick="handleRecurring(1)">Recurring Membership</button>
          </div>
        </div>

        <!-- Tier 2: Copper -->
        <div class="tier-card" data-tier="2">
          <h3>🔶 Copper — Monthly Custom (~20 img)</h3>
          <div class="tier-price">$15 <span>/ month</span></div>
          <ul class="tier-perks">
            <li>Everything in Bronze, plus:</li>
            <li>One (1) custom image request per billing cycle.</li>
            <li>Approx. 20 images per request.</li>
            <li>Single character, official/creator‑selected outfit.</li>
            <li>Some character customization allowed.</li>
            <li>Typical turnaround: ~1 day (queue order).</li>
          </ul>
          <div class="button-row">
            <button class="tier-btn btn-single" onclick="handleSinglePurchase(2)">Single Purchase</button>
            <button class="tier-btn btn-recurring" onclick="handleRecurring(2)">Recurring Membership</button>
          </div>
        </div>

        <!-- Tier 3: Silver -->
        <div class="tier-card" data-tier="3">
          <h3>🥈 Silver — Monthly Custom (~40 img)</h3>
          <div class="tier-price">$30 <span>/ month</span></div>
          <ul class="tier-perks">
            <li>Everything in Bronze, plus:</li>
            <li>One (1) custom image request per billing cycle.</li>
            <li>Approx. 40 images per request.</li>
            <li>Single character, custom outfit allowed.</li>
            <li>Character customization allowed.</li>
            <li>Typical turnaround: ~1 day (queue order).</li>
          </ul>
          <div class="button-row">
            <button class="tier-btn btn-single" onclick="handleSinglePurchase(3)">Single Purchase</button>
            <button class="tier-btn btn-recurring" onclick="handleRecurring(3)">Recurring Membership</button>
          </div>
        </div>

        <!-- Tier 4: Gold -->
        <div class="tier-card" data-tier="4">
          <h3>🏅 Gold — Large Custom (~80 img)</h3>
          <div class="tier-price">$50 <span>/ month</span></div>
          <ul class="tier-perks">
            <li>Everything in Bronze, plus:</li>
            <li>One (1) large custom image request per billing cycle.</li>
            <li>Approx. 80 images per request.</li>
            <li>Single character, custom outfit allowed.</li>
            <li>Character customization allowed.</li>
            <li>Typical turnaround: 3‑7 days (queue order).</li>
            <li>Special/expanded requests may be discussed.</li>
          </ul>
          <div class="button-row">
            <button class="tier-btn btn-single" onclick="handleSinglePurchase(4)">Single Purchase</button>
            <button class="tier-btn btn-recurring" onclick="handleRecurring(4)">Recurring Membership</button>
          </div>
        </div>

        <!-- Tier 5: Platinum -->
        <div class="tier-card" data-tier="5">
          <h3>💎 Platinum — Priority Large Custom</h3>
          <div class="tier-price">$75 <span>/ month</span></div>
          <ul class="tier-perks">
            <li>Everything in Bronze, plus:</li>
            <li>One (1) large custom image request per billing cycle.</li>
            <li>Approx. 80 images per request.</li>
            <li>Single character, custom outfit allowed.</li>
            <li>Character customization allowed.</li>
            <li>⚡ Priority: worked on first after current tasks.</li>
            <li>Typical turnaround: 3‑7 days (once started).</li>
          </ul>
          <div class="button-row">
            <button class="tier-btn btn-single" onclick="handleSinglePurchase(5)">Single Purchase</button>
            <button class="tier-btn btn-recurring" onclick="handleRecurring(5)">Recurring Membership</button>
          </div>
        </div>
      </div>

      <!-- Carousel navigation arrows -->
      <button class="carousel-arrow arrow-left" onclick="scrollCarousel(-1)" aria-label="Previous tiers">←</button>
      <button class="carousel-arrow arrow-right" onclick="scrollCarousel(1)" aria-label="Next tiers">→</button>
    </div>

    <!-- Status message (kept for backward compatibility, but we'll use snackbar for errors) -->
    <div id="statusMessage"></div>
  </main>

  <script src="https://velutinx.com/assets/js/header.js"></script>
  <script src="https://velutinx.com/assets/js/shop-shared.js"></script>

  <script>
    // ----- Carousel scroll function -----
    window.scrollCarousel = function(direction) {
      const container = document.getElementById('tierCarousel');
      if (!container) return;
      const scrollAmount = 320; // approximate card width + gap
      container.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
    };

    // ----- Discord help dropdown toggle -----
    document.addEventListener('DOMContentLoaded', function() {
      const toggle = document.getElementById('discordHelpToggle');
      const content = document.getElementById('discordHelpContent');
      if (toggle && content) {
        toggle.addEventListener('click', function(e) {
          e.preventDefault();
          content.classList.toggle('show');
        });
      }
    });

    // ----- Helper: get the current cart array (works with shop-shared.js) -----
    function getCurrentCart() {
      // Try window.cart first (most direct)
      if (Array.isArray(window.cart)) {
        return window.cart;
      }
      // Fallback to window.getCart() if available
      if (typeof window.getCart === 'function') {
        return window.getCart();
      }
      // Last resort: return empty array and warn
      console.warn('Cart not found, initializing empty cart');
      window.cart = [];
      return window.cart;
    }

    // ----- Helper: save cart and trigger UI update -----
    function updateCartAndUI(newCart) {
      // Update the cart reference
      if (Array.isArray(window.cart)) {
        window.cart = newCart;
      }
      // If there's a setter function, use it
      if (typeof window.setCart === 'function') {
        window.setCart(newCart);
      }
      // Trigger display update
      if (typeof window.updateCartDisplay === 'function') {
        window.updateCartDisplay();
      } else {
        // If no update function, at least update membership buttons
        updateMembershipButtons();
        // Also try to update the cart count badge manually?
        const cartCount = document.getElementById('cartCount');
        if (cartCount) {
          cartCount.textContent = newCart.length;
        }
      }
    }

    // ----- Helper: check if a membership tier is in the cart -----
    function isMembershipInCart(tierNumber) {
      const cart = getCurrentCart();
      return cart.some(item => item.id === `membership-${tierNumber}`);
    }

    // ----- Get current highest membership tier from cart (or null) -----
    function getHighestMembershipTier() {
      const cart = getCurrentCart();
      const membershipItems = cart.filter(item => item.type === 'membership');
      if (membershipItems.length === 0) return null;
      const tiers = membershipItems.map(item => item.tier);
      return Math.max(...tiers);
    }

    // ----- Update all membership buttons based on cart state -----
    function updateMembershipButtons() {
      for (let tier = 1; tier <= 5; tier++) {
        const card = document.querySelector(`.tier-card[data-tier="${tier}"]`);
        if (!card) continue;
        const btn = card.querySelector('.btn-single, .btn-remove');
        if (!btn) continue;
        const inCart = isMembershipInCart(tier);
        btn.textContent = inCart ? 'Remove from Cart' : 'Single Purchase';
        btn.classList.toggle('btn-single', !inCart);
        btn.classList.toggle('btn-remove', inCart);
      }
    }

    // ----- Show a snackbar message (green for success, red for error) -----
    function showSnackbar(message, isError = false) {
      const snackbar = document.getElementById('snackbar');
      const snackText = document.getElementById('snackText');
      snackText.textContent = message;
      snackbar.classList.remove('error');
      if (isError) snackbar.classList.add('error');
      snackbar.classList.add('show');
      setTimeout(() => snackbar.classList.remove('show', 'error'), 2400);
    }

    // ----- Validate Discord ID and return it, or show error snackbar -----
    function validateDiscordId() {
      const discordInput = document.getElementById('discordId');
      const id = discordInput.value.trim();
      if (!id) {
        showSnackbar('❌ Please enter your Discord ID', true);
        return null;
      }
      if (!/^\d{17,19}$/.test(id)) {
        showSnackbar('❌ Invalid Discord ID format (should be 17‑19 numbers)', true);
        return null;
      }
      return id;
    }

    // ----- Single purchase handler: enforces only one membership (highest tier) -----
    window.handleSinglePurchase = async function(tierNumber) {
      console.log('handleSinglePurchase called for tier', tierNumber);
      const discordId = validateDiscordId();
      if (!discordId) return;

      // Prices for tiers 1–5 (update as needed)
      const tierPrices = { 1: 5.00, 2: 15.00, 3: 30.00, 4: 50.00, 5: 75.00 };
      const price = tierPrices[tierNumber];
      if (!price) {
        showSnackbar('Invalid tier', true);
        return;
      }

      // Tier titles for display
      const tierTitles = {
        1: 'Bronze — Archive Access',
        2: 'Copper — Monthly Custom (~20 img)',
        3: 'Silver — Monthly Custom (~40 img)',
        4: 'Gold — Large Custom (~80 img)',
        5: 'Platinum — Priority Large Custom'
      };

      // Get current cart
      let cart = getCurrentCart();
      
      // Separate membership items from others
      const nonMembershipItems = cart.filter(item => item.type !== 'membership');
      const existingMembershipItems = cart.filter(item => item.type === 'membership');
      
      // Determine highest existing tier (if any)
      let highestExistingTier = null;
      if (existingMembershipItems.length > 0) {
        highestExistingTier = Math.max(...existingMembershipItems.map(item => item.tier));
      }

      // Check if the clicked tier is already in cart (for toggle)
      const alreadyInCart = existingMembershipItems.some(item => item.tier === tierNumber);

      // Decision logic
      if (alreadyInCart) {
        // Remove this tier (toggle off)
        cart = [...nonMembershipItems]; // keep only non-membership items
        showSnackbar('Removed from cart', false);
      } else {
        // Not in cart: check if we can add
        if (highestExistingTier !== null && tierNumber < highestExistingTier) {
          // Trying to add a lower tier while higher exists -> error
          showSnackbar('❌ Only the highest tier can be added. Please remove the higher tier first.', true);
          return;
        } else {
          // Allowed: remove any existing membership (lower or same? same not possible because alreadyInCart false)
          // Then add the new tier
          const newItem = {
            id: `membership-${tierNumber}`,
            title: tierTitles[tierNumber] + ' (30 days)',
            price: price,
            type: 'membership',
            tier: tierNumber,
            discordId: discordId
          };
          cart = [...nonMembershipItems, newItem];
          showSnackbar('Added to cart', false);
        }
      }

      // Update the cart and UI
      updateCartAndUI(cart);
      
      // Also manually update membership buttons (in case updateCartDisplay doesn't do it)
      updateMembershipButtons();
    };

    // ----- Recurring handler (placeholder, will be replaced with PayPal subscriptions) -----
    window.handleRecurring = async function(tierNumber) {
      const discordId = validateDiscordId();
      if (!discordId) return;

      // Placeholder plan IDs – replace with actual PayPal plan IDs later
      const PLAN_IDS = {
        1: 'P-BRONZE_PLAN_ID',
        2: 'P-COPPER_PLAN_ID',
        3: 'P-SILVER_PLAN_ID',
        4: 'P-GOLD_PLAN_ID',
        5: 'P-PLATINUM_PLAN_ID'
      };
      const planId = PLAN_IDS[tierNumber];
      if (!planId) {
        showSnackbar('❌ Plan not configured for this tier', true);
        return;
      }
      alert(`Recurring subscription for Tier ${tierNumber} (plan ID: ${planId}) would start.`);
    };

    // ----- Override updateCartDisplay to also refresh membership buttons -----
    const originalUpdateCartDisplay = window.updateCartDisplay;
    window.updateCartDisplay = function() {
      if (originalUpdateCartDisplay) originalUpdateCartDisplay();
      updateMembershipButtons();
    };

    // ----- Page setup -----
    window.addEventListener('load', function() {
      // Theme toggle
      document.getElementById('themeBtn').onclick = function() {
        document.body.classList.toggle('dark');
        localStorage.setItem('darkMode', document.body.classList.contains('dark'));
      };
      if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark');
      }

      // Cart drawer open/close
      const cartBtn = document.getElementById('cartBtn');
      const floatingCartBtn = document.getElementById('floatingCartBtn');
      const cartClose = document.getElementById('cartClose');
      const cartDrawer = document.getElementById('cartDrawer');

      if (cartBtn) {
        cartBtn.addEventListener('click', () => {
          cartDrawer.classList.add('open');
          if (typeof initPayPalButtons === 'function') setTimeout(initPayPalButtons, 500);
        });
      }
      if (floatingCartBtn) {
        floatingCartBtn.addEventListener('click', () => {
          cartDrawer.classList.add('open');
          if (typeof initPayPalButtons === 'function') setTimeout(initPayPalButtons, 500);
        });
      }
      if (cartClose) {
        cartClose.addEventListener('click', () => {
          cartDrawer.classList.remove('open');
        });
      }

      // Initial button state
      updateMembershipButtons();
    });
  </script>
</body>
</html>
