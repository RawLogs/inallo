# Allora Wallet Tracker

A Next.js application for tracking wallets, transactions, and detecting sybil networks on the Allora blockchain.

## Features

- 🔍 **Wallet Tracking**: Search and analyze any Allora wallet address (allo...)
- 💸 **Transaction History**: View all send/receive transactions with detailed information
- 🕸️ **Network Visualization**: Interactive D3.js graph showing wallet connections
- 📊 **Real-time Data**: Connect to Allora mainnet API and RPC endpoints
- 🎨 **Modern UI**: Beautiful, responsive interface with dark theme
- 🖱️ **Interactive Graph**: Drag and drop nodes, hover for details

## Tech Stack

- **Next.js 14** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **D3.js** - Interactive network visualization
- **Axios** - HTTP client
- **date-fns** - Date formatting

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Run development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## API Endpoints

The application uses:
- **API**: https://allora-api.mainnet.allora.network/
- **RPC**: https://allora-rpc.mainnet.allora.network/

## Usage

1. **Enter a wallet address** in the search box (e.g., any Allora wallet address)
2. **View wallet information**:
   - Current balance
   - Total transactions count
   - Total transfers count
3. **Browse transactions**:
   - See all send/receive transactions
   - View transaction details (hash, gas, timestamp)
   - Click transaction hash to view on explorer
   - See transfer amounts and addresses
4. **Visualize wallet network**:
   - Interactive D3.js force-directed graph
   - Automatically detects connected wallets
   - Adjust network depth (1-3 levels)
   - Drag nodes to rearrange
   - Hover for wallet details
   - View connection statistics

## Example Transaction

You can test with the provided transaction hash:
- Hash: `AA6718124852DCD1C3317A9376F0F1AF0754B2C0A790E6BF57BD7816B466ADDD`
- Explorer: https://staging.explorer.allora.network/explorer/transactions/AA6718124852DCD1C3317A9376F0F1AF0754B2C0A790E6BF57BD7816B466ADDD

## Features in Detail

### Wallet Tracking
- Real-time balance checking
- Complete transaction history
- Transfer event parsing
- Input: Allora wallet address (allo...)

### Network Visualization
- Interactive D3.js force-directed graph
- Network graph building with configurable depth
- Connection statistics
- Drag-and-drop node interaction
- Hover tooltips for wallet details

## License

MIT

