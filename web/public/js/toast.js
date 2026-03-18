// toast.js

(function() {
    // Create and inject CSS once
    const style = document.createElement('style');
    style.textContent = `
        .toast-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        }

        .toast {
            background: #4caf50;
            color: white;
            border-radius: 6px;
            padding: 12px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 250px;
            max-width: 350px;
            animation: slideInRight 0.3s ease, fadeOut 0.3s ease 2.7s forwards;
            pointer-events: auto;
            opacity: 0.95;
        }

        .toast.error {
            background: #f44336;
        }

        .toast .title {
            font-weight: 600;
            font-size: 1rem;
        }

        .toast .message {
            font-size: 0.9rem;
            opacity: 0.9;
        }

        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }

        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }
    `;
    document.head.appendChild(style);

    // Create container if not exists
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    window.showToast = function(title, message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="title">${title}</div>
            <div class="message">${message}</div>
        `;
        container.appendChild(toast);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.remove();
        }, 3000);
    };
})();
