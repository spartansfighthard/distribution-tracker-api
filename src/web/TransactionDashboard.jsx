import React, { useState, useEffect } from 'react';
import axios from 'axios';

// API base URL - change this to match your API server
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

// Format number with commas and decimal places
const formatNumber = (num, decimals = 7) => {
  if (num === undefined || num === null) return '0.0000000';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

// Shorten address for display
const shortenAddress = (address) => {
  if (!address) return '';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

const TransactionDashboard = () => {
  const [stats, setStats] = useState(null);
  const [distributions, setDistributions] = useState(null);
  const [taxTransactions, setTaxTransactions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('stats');
  const [refreshing, setRefreshing] = useState(false);

  // Fetch data from API
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch stats
      const statsResponse = await axios.get(`${API_BASE_URL}/stats`);
      setStats(statsResponse.data.data);
      
      // Fetch distributions
      const distributionsResponse = await axios.get(`${API_BASE_URL}/distributions`);
      setDistributions(distributionsResponse.data.data);
      
      // Fetch tax transactions
      const taxResponse = await axios.get(`${API_BASE_URL}/tax`);
      setTaxTransactions(taxResponse.data.data);
      
      setLoading(false);
    } catch (error) {
      console.error('Error fetching data:', error);
      setError(error.response?.data?.error?.message || error.message || 'Unknown error');
      setLoading(false);
    }
  };
  
  // Force refresh data
  const refreshData = async () => {
    setRefreshing(true);
    
    try {
      await axios.post(`${API_BASE_URL}/refresh`);
      await fetchData();
    } catch (error) {
      console.error('Error refreshing data:', error);
      setError(error.response?.data?.error?.message || error.message || 'Unknown error');
    } finally {
      setRefreshing(false);
    }
  };
  
  // Fetch data on component mount
  useEffect(() => {
    fetchData();
    
    // Refresh data every 5 minutes
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  // Render loading state
  if (loading && !stats) {
    return (
      <div className="transaction-dashboard loading">
        <div className="loading-spinner"></div>
        <p>Loading transaction data...</p>
      </div>
    );
  }
  
  // Render error state
  if (error && !stats) {
    return (
      <div className="transaction-dashboard error">
        <h2>Error Loading Data</h2>
        <p>{error}</p>
        <button onClick={fetchData}>Try Again</button>
      </div>
    );
  }
  
  return (
    <div className="transaction-dashboard">
      <div className="dashboard-header">
        <h1>SOL Distribution Dashboard</h1>
        <div className="refresh-button">
          <button onClick={refreshData} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh Data'}
          </button>
        </div>
      </div>
      
      <div className="dashboard-tabs">
        <button 
          className={activeTab === 'stats' ? 'active' : ''} 
          onClick={() => setActiveTab('stats')}
        >
          Statistics
        </button>
        <button 
          className={activeTab === 'distributions' ? 'active' : ''} 
          onClick={() => setActiveTab('distributions')}
        >
          Distributions
        </button>
        <button 
          className={activeTab === 'tax' ? 'active' : ''} 
          onClick={() => setActiveTab('tax')}
        >
          Tax Transactions
        </button>
      </div>
      
      <div className="dashboard-content">
        {activeTab === 'stats' && stats && (
          <div className="stats-tab">
            <div className="stats-cards">
              <div className="stats-card">
                <h3>Total SOL Distributed</h3>
                <div className="stats-value">{formatNumber(stats.totalSolSent)} SOL</div>
              </div>
              <div className="stats-card">
                <h3>Total SOL Received</h3>
                <div className="stats-value">{formatNumber(stats.totalSolReceived)} SOL</div>
              </div>
              <div className="stats-card">
                <h3>Tax SOL Received</h3>
                <div className="stats-value">{formatNumber(stats.totalTaxReceived)} SOL</div>
              </div>
              <div className="stats-card">
                <h3>Current Balance</h3>
                <div className="stats-value">{formatNumber(stats.currentBalance)} SOL</div>
              </div>
              <div className="stats-card">
                <h3>Total Transactions</h3>
                <div className="stats-value">{stats.transactionCount}</div>
              </div>
            </div>
            
            <div className="wallet-info">
              <p>Distribution Wallet: <code>{process.env.REACT_APP_DISTRIBUTION_WALLET_ADDRESS}</code></p>
              <a 
                href={`https://solscan.io/account/${process.env.REACT_APP_DISTRIBUTION_WALLET_ADDRESS}`} 
                target="_blank" 
                rel="noopener noreferrer"
              >
                View on Solscan
              </a>
            </div>
          </div>
        )}
        
        {activeTab === 'distributions' && distributions && (
          <div className="distributions-tab">
            <div className="distributions-header">
              <h2>SOL Distribution Transactions</h2>
              <div className="distributions-total">
                <p>Total SOL Distributed: <strong>{formatNumber(distributions.totalSolSent)} SOL</strong></p>
              </div>
            </div>
            
            <div className="transactions-list">
              {distributions.transactions.length === 0 ? (
                <p className="no-transactions">No distribution transactions found.</p>
              ) : (
                distributions.transactions.map((tx, index) => (
                  <div className="transaction-card" key={tx.signature}>
                    <div className="transaction-header">
                      <div className="transaction-amount">{formatNumber(tx.solAmount)} SOL</div>
                      <div className="transaction-date">{tx.date}</div>
                    </div>
                    <div className="transaction-details">
                      <div className="transaction-from">
                        From: {shortenAddress(process.env.REACT_APP_DISTRIBUTION_WALLET_ADDRESS)}
                      </div>
                      {tx.recipients && (
                        <div className="transaction-recipients">
                          To: {tx.recipients.length} recipient(s)
                        </div>
                      )}
                      <div className="transaction-signature">
                        Signature: {tx.signature.slice(0, 8)}...
                      </div>
                      <a 
                        href={`https://solscan.io/tx/${tx.signature}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="transaction-link"
                      >
                        View on Solscan
                      </a>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === 'tax' && taxTransactions && (
          <div className="tax-tab">
            <div className="tax-header">
              <h2>Tax SOL Transactions</h2>
              <div className="tax-total">
                <p>Total Tax SOL Received: <strong>{formatNumber(taxTransactions.totalTaxReceived)} SOL</strong></p>
              </div>
            </div>
            
            <div className="transactions-list">
              {taxTransactions.transactions.length === 0 ? (
                <p className="no-transactions">
                  No tax transactions found.
                  {!process.env.REACT_APP_TAX_CONTRACT_ADDRESS && (
                    <span className="tax-note">
                      Note: To track tax transactions, set the TAX_CONTRACT_ADDRESS environment variable.
                    </span>
                  )}
                </p>
              ) : (
                taxTransactions.transactions.map((tx, index) => (
                  <div className="transaction-card" key={tx.signature}>
                    <div className="transaction-header">
                      <div className="transaction-amount">{formatNumber(tx.solAmount)} SOL</div>
                      <div className="transaction-date">{tx.date}</div>
                    </div>
                    <div className="transaction-details">
                      <div className="transaction-from">
                        From: {shortenAddress(tx.sender)}
                      </div>
                      <div className="transaction-to">
                        To: {shortenAddress(process.env.REACT_APP_DISTRIBUTION_WALLET_ADDRESS)}
                      </div>
                      <div className="transaction-signature">
                        Signature: {tx.signature.slice(0, 8)}...
                      </div>
                      <a 
                        href={`https://solscan.io/tx/${tx.signature}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="transaction-link"
                      >
                        View on Solscan
                      </a>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      
      {error && (
        <div className="dashboard-error">
          <p>Error: {error}</p>
          <button onClick={fetchData}>Try Again</button>
        </div>
      )}
      
      <div className="dashboard-footer">
        <p>Last updated: {new Date().toLocaleString()}</p>
      </div>
    </div>
  );
};

export default TransactionDashboard; 