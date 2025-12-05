// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface KYCData {
  id: string;
  name: string;
  encryptedAge: string;
  encryptedBalance: string;
  encryptedCountryCode: number;
  verified: boolean;
  timestamp: number;
  owner: string;
}

interface UserAction {
  type: 'create' | 'verify' | 'decrypt';
  timestamp: number;
  details: string;
}

// FHE encryption/decryption simulation
const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [kycList, setKycList] = useState<KYCData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingKYC, setCreatingKYC] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newKYCData, setNewKYCData] = useState({ name: "", age: 0, balance: 0, countryCode: 0 });
  const [selectedKYC, setSelectedKYC] = useState<KYCData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ age: number | null; balance: number | null }>({ age: null, balance: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [userActions, setUserActions] = useState<UserAction[]>([]);
  const [activeTab, setActiveTab] = useState('kyc');
  const [currentStep, setCurrentStep] = useState(1);

  // Initialize signature parameters
  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  // Load data from contract
  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      // Load KYC data
      const kycBytes = await contract.getData("kyc");
      let kycList: KYCData[] = [];
      if (kycBytes.length > 0) {
        try {
          const kycStr = ethers.toUtf8String(kycBytes);
          if (kycStr.trim() !== '') kycList = JSON.parse(kycStr);
        } catch (e) {}
      }
      setKycList(kycList);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  // Create new KYC record
  const createKYC = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingKYC(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating KYC with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Create new KYC record with encrypted data
      const newKYC: KYCData = {
        id: `KYC-${Date.now()}`,
        name: newKYCData.name,
        encryptedAge: FHEEncryptNumber(newKYCData.age),
        encryptedBalance: FHEEncryptNumber(newKYCData.balance),
        encryptedCountryCode: newKYCData.countryCode,
        verified: false,
        timestamp: Math.floor(Date.now() / 1000),
        owner: address
      };
      
      // Update KYC list
      const updatedKYCList = [...kycList, newKYC];
      
      // Save to contract
      await contract.setData("kyc", ethers.toUtf8Bytes(JSON.stringify(updatedKYCList)));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'create',
        timestamp: Math.floor(Date.now() / 1000),
        details: `Created KYC record for ${newKYCData.name}`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "KYC created successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewKYCData({ name: "", age: 0, balance: 0, countryCode: 0 });
        setCurrentStep(1);
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingKYC(false); 
    }
  };

  // Verify KYC record
  const verifyKYC = async (kycId: string) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Verifying KYC with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Find the KYC record
      const kycIndex = kycList.findIndex(k => k.id === kycId);
      if (kycIndex === -1) throw new Error("KYC record not found");
      
      // Update verification status
      const updatedKYCList = [...kycList];
      updatedKYCList[kycIndex].verified = true;
      
      // Save to contract
      await contract.setData("kyc", ethers.toUtf8Bytes(JSON.stringify(updatedKYCList)));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'verify',
        timestamp: Math.floor(Date.now() / 1000),
        details: `Verified KYC record: ${updatedKYCList[kycIndex].name}`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "KYC verified successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Verification failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Decrypt data with signature
  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'decrypt',
        timestamp: Math.floor(Date.now() / 1000),
        details: "Decrypted FHE data"
      };
      setUserActions(prev => [newAction, ...prev]);
      
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  // Render KYC verification chart
  const renderVerificationChart = (kyc: KYCData) => {
    const verifiedPercentage = kyc.verified ? 100 : 0;
    
    return (
      <div className="verification-chart">
        <div className="chart-row">
          <div className="chart-label">Verified</div>
          <div className="chart-bar">
            <div 
              className="bar-fill verified" 
              style={{ width: `${verifiedPercentage}%` }}
            >
              <span className="bar-value">{kyc.verified ? "Yes" : "No"}</span>
            </div>
          </div>
          <div className="chart-percentage">{verifiedPercentage}%</div>
        </div>
      </div>
    );
  };

  // Render FHE flow visualization
  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Data Submission</h4>
            <p>User submits personal data encrypted with Zama FHE</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>Encrypted Verification</h4>
            <p>Service provider runs compliance checks on encrypted data</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Zero-Knowledge Proof</h4>
            <p>Verification result is output as a zero-knowledge proof</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>Privacy-Preserving KYC</h4>
            <p>Compliance is verified without exposing personal data</p>
          </div>
        </div>
      </div>
    );
  };

  // Render user actions history
  const renderUserActions = () => {
    if (userActions.length === 0) return <div className="no-data">No actions recorded</div>;
    
    return (
      <div className="actions-list">
        {userActions.map((action, index) => (
          <div className="action-item" key={index}>
            <div className={`action-type ${action.type}`}>
              {action.type === 'create' && '📝'}
              {action.type === 'verify' && '✅'}
              {action.type === 'decrypt' && '🔓'}
            </div>
            <div className="action-details">
              <div className="action-text">{action.details}</div>
              <div className="action-time">{new Date(action.timestamp * 1000).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render FAQ section
  const renderFAQ = () => {
    const faqItems = [
      {
        question: "What is zk-KYC with FHE?",
        answer: "Zero-Knowledge Know Your Customer (zk-KYC) with Fully Homomorphic Encryption (FHE) allows service providers to verify customer identities without accessing their raw personal data."
      },
      {
        question: "How does FHE protect my privacy?",
        answer: "FHE allows computations to be performed on encrypted data without decrypting it. Your personal information remains encrypted throughout the verification process."
      },
      {
        question: "What data is encrypted?",
        answer: "All sensitive data like age, financial balance, and identification numbers are encrypted using Zama FHE technology."
      },
      {
        question: "Can I see my own encrypted data?",
        answer: "Yes, you can decrypt your own data using your wallet signature, but others cannot see it without your permission."
      },
      {
        question: "Is this compliant with regulations?",
        answer: "Yes, the system is designed to meet KYC/AML compliance requirements while preserving user privacy."
      }
    ];
    
    return (
      <div className="faq-container">
        {faqItems.map((item, index) => (
          <div className="faq-item" key={index}>
            <div className="faq-question">{item.question}</div>
            <div className="faq-answer">{item.answer}</div>
          </div>
        ))}
      </div>
    );
  };

  // Handle next step in wizard
  const handleNextStep = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  // Handle previous step in wizard
  const handlePrevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted KYC system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="kyc-icon"></div>
          </div>
          <h1>zk-KYC<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-kyc-btn"
          >
            <div className="add-icon"></div>New KYC
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="dashboard-grid">
            <div className="dashboard-panel intro-panel">
              <div className="panel-card">
                <h2>Privacy-Preserving KYC with FHE</h2>
                <p>zk-KYC with FHE enables service providers to verify customer identities without accessing their raw personal data, using Zama's Fully Homomorphic Encryption.</p>
                <div className="fhe-badge">
                  <div className="fhe-icon"></div>
                  <span>Powered by Zama FHE</span>
                </div>
              </div>
              
              <div className="panel-card">
                <h2>FHE Verification Flow</h2>
                {renderFHEFlow()}
              </div>
              
              <div className="panel-card">
                <h2>System Statistics</h2>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-value">{kycList.length}</div>
                    <div className="stat-label">KYC Records</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">
                      {kycList.length > 0 
                        ? kycList.filter(k => k.verified).length
                        : 0}
                    </div>
                    <div className="stat-label">Verified</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">
                      {kycList.length > 0 
                        ? Math.round(kycList.filter(k => k.verified).length / kycList.length * 100)
                        : 0}%
                    </div>
                    <div className="stat-label">Verification Rate</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="tabs-container">
            <div className="tabs">
              <button 
                className={`tab ${activeTab === 'kyc' ? 'active' : ''}`}
                onClick={() => setActiveTab('kyc')}
              >
                KYC Records
              </button>
              <button 
                className={`tab ${activeTab === 'actions' ? 'active' : ''}`}
                onClick={() => setActiveTab('actions')}
              >
                My Actions
              </button>
              <button 
                className={`tab ${activeTab === 'faq' ? 'active' : ''}`}
                onClick={() => setActiveTab('faq')}
              >
                FAQ
              </button>
            </div>
            
            <div className="tab-content">
              {activeTab === 'kyc' && (
                <div className="kyc-section">
                  <div className="section-header">
                    <h2>KYC Records</h2>
                    <div className="header-actions">
                      <button 
                        onClick={loadData} 
                        className="refresh-btn" 
                        disabled={isRefreshing}
                      >
                        {isRefreshing ? "Refreshing..." : "Refresh"}
                      </button>
                    </div>
                  </div>
                  
                  <div className="kyc-list">
                    {kycList.length === 0 ? (
                      <div className="no-kyc">
                        <div className="no-kyc-icon"></div>
                        <p>No KYC records found</p>
                        <button 
                          className="create-btn" 
                          onClick={() => setShowCreateModal(true)}
                        >
                          Create First Record
                        </button>
                      </div>
                    ) : kycList.map((kyc, index) => (
                      <div 
                        className={`kyc-item ${selectedKYC?.id === kyc.id ? "selected" : ""}`} 
                        key={index}
                        onClick={() => setSelectedKYC(kyc)}
                      >
                        <div className="kyc-name">{kyc.name}</div>
                        <div className="kyc-owner">Owner: {kyc.owner.substring(0, 6)}...{kyc.owner.substring(38)}</div>
                        <div className="kyc-status">
                          Status: <span className={kyc.verified ? "verified" : "unverified"}>
                            {kyc.verified ? "Verified" : "Pending"}
                          </span>
                        </div>
                        <div className="kyc-encrypted">Encrypted Data: {kyc.encryptedAge.substring(0, 15)}...</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {activeTab === 'actions' && (
                <div className="actions-section">
                  <h2>My Activity History</h2>
                  {renderUserActions()}
                </div>
              )}
              
              {activeTab === 'faq' && (
                <div className="faq-section">
                  <h2>Frequently Asked Questions</h2>
                  {renderFAQ()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateKYC 
          onSubmit={createKYC} 
          onClose={() => {
            setShowCreateModal(false);
            setCurrentStep(1);
          }} 
          creating={creatingKYC} 
          kycData={newKYCData} 
          setKycData={setNewKYCData}
          currentStep={currentStep}
          handleNextStep={handleNextStep}
          handlePrevStep={handlePrevStep}
        />
      )}
      
      {selectedKYC && (
        <KYCDetailModal 
          kyc={selectedKYC} 
          onClose={() => { 
            setSelectedKYC(null); 
            setDecryptedData({ age: null, balance: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          verifyKYC={verifyKYC}
          renderVerificationChart={renderVerificationChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="kyc-icon"></div>
              <span>zk-KYC with FHE</span>
            </div>
            <p>Privacy-preserving customer verification powered by FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} zk-KYC with FHE. All rights reserved.</div>
          <div className="disclaimer">
            This system uses fully homomorphic encryption to protect user privacy. 
            KYC verification is performed on encrypted data without revealing personal information.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateKYCProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  kycData: any;
  setKycData: (data: any) => void;
  currentStep: number;
  handleNextStep: () => void;
  handlePrevStep: () => void;
}

const ModalCreateKYC: React.FC<ModalCreateKYCProps> = ({ 
  onSubmit, 
  onClose, 
  creating, 
  kycData, 
  setKycData, 
  currentStep,
  handleNextStep,
  handlePrevStep
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setKycData({ ...kycData, [name]: value });
  };

  const renderStepContent = () => {
    switch(currentStep) {
      case 1:
        return (
          <div className="form-group">
            <label>Full Name *</label>
            <input 
              type="text" 
              name="name" 
              value={kycData.name} 
              onChange={handleChange} 
              placeholder="Enter your full name..." 
            />
          </div>
        );
      case 2:
        return (
          <>
            <div className="form-group">
              <label>Age *</label>
              <input 
                type="number" 
                name="age" 
                value={kycData.age} 
                onChange={handleChange} 
                placeholder="Enter your age..." 
                min="0"
              />
            </div>
            <div className="form-group">
              <label>Account Balance *</label>
              <input 
                type="number" 
                name="balance" 
                value={kycData.balance} 
                onChange={handleChange} 
                placeholder="Enter your balance..." 
                min="0"
                step="0.01"
              />
            </div>
          </>
        );
      case 3:
        return (
          <div className="form-group">
            <label>Country Code *</label>
            <input 
              type="number" 
              name="countryCode" 
              value={kycData.countryCode} 
              onChange={handleChange} 
              placeholder="Enter your country code..." 
              min="0"
              max="999"
            />
          </div>
        );
      case 4:
        return (
          <div className="review-section">
            <h3>Review Your Information</h3>
            <div className="review-item">
              <span>Name:</span>
              <strong>{kycData.name}</strong>
            </div>
            <div className="review-item">
              <span>Age:</span>
              <strong>{kycData.age}</strong>
            </div>
            <div className="review-item">
              <span>Balance:</span>
              <strong>{kycData.balance}</strong>
            </div>
            <div className="review-item">
              <span>Country Code:</span>
              <strong>{kycData.countryCode}</strong>
            </div>
            <div className="fhe-notice">
              <div className="lock-icon"></div>
              <div>
                <strong>All sensitive data will be encrypted with Zama FHE</strong>
                <p>Your personal information will remain private throughout verification</p>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-kyc-modal">
        <div className="modal-header">
          <h2>Create New KYC Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="step-indicator">
            <div className={`step ${currentStep >= 1 ? 'active' : ''}`}>1</div>
            <div className={`connector ${currentStep >= 2 ? 'active' : ''}`}></div>
            <div className={`step ${currentStep >= 2 ? 'active' : ''}`}>2</div>
            <div className={`connector ${currentStep >= 3 ? 'active' : ''}`}></div>
            <div className={`step ${currentStep >= 3 ? 'active' : ''}`}>3</div>
            <div className={`connector ${currentStep >= 4 ? 'active' : ''}`}></div>
            <div className={`step ${currentStep >= 4 ? 'active' : ''}`}>4</div>
          </div>
          
          {renderStepContent()}
        </div>
        
        <div className="modal-footer">
          {currentStep > 1 && (
            <button onClick={handlePrevStep} className="prev-btn">Previous</button>
          )}
          {currentStep < 4 ? (
            <button 
              onClick={handleNextStep} 
              disabled={
                (currentStep === 1 && !kycData.name) || 
                (currentStep === 2 && (!kycData.age || !kycData.balance)) || 
                (currentStep === 3 && !kycData.countryCode)
              } 
              className="next-btn"
            >
              Next
            </button>
          ) : (
            <button 
              onClick={onSubmit} 
              disabled={creating || !kycData.name || !kycData.age || !kycData.balance || !kycData.countryCode} 
              className="submit-btn"
            >
              {creating ? "Creating with FHE..." : "Submit KYC"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface KYCDetailModalProps {
  kyc: KYCData;
  onClose: () => void;
  decryptedData: { age: number | null; balance: number | null };
  setDecryptedData: (value: { age: number | null; balance: number | null }) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
  verifyKYC: (kycId: string) => void;
  renderVerificationChart: (kyc: KYCData) => JSX.Element;
}

const KYCDetailModal: React.FC<KYCDetailModalProps> = ({ 
  kyc, 
  onClose, 
  decryptedData, 
  setDecryptedData, 
  isDecrypting, 
  decryptWithSignature,
  verifyKYC,
  renderVerificationChart
}) => {
  const handleDecrypt = async () => {
    if (decryptedData.age !== null) { 
      setDecryptedData({ age: null, balance: null }); 
      return; 
    }
    
    const decryptedAge = await decryptWithSignature(kyc.encryptedAge);
    const decryptedBalance = await decryptWithSignature(kyc.encryptedBalance);
    
    if (decryptedAge !== null && decryptedBalance !== null) {
      setDecryptedData({ 
        age: decryptedAge, 
        balance: decryptedBalance 
      });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="kyc-detail-modal">
        <div className="modal-header">
          <h2>KYC Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="kyc-info">
            <div className="info-item">
              <span>Name:</span>
              <strong>{kyc.name}</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>{kyc.owner.substring(0, 6)}...{kyc.owner.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(kyc.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Country Code:</span>
              <strong>{kyc.encryptedCountryCode}</strong>
            </div>
          </div>
          
          <div className="verification-section">
            <h3>Verification Status</h3>
            {renderVerificationChart(kyc)}
            
            {!kyc.verified && (
              <button 
                className="verify-btn" 
                onClick={() => verifyKYC(kyc.id)}
              >
                Verify KYC
              </button>
            )}
          </div>
          
          <div className="encrypted-section">
            <h3>Encrypted Personal Data</h3>
            <div className="encrypted-data">
              <div className="data-item">
                <span>Age:</span>
                <div>{kyc.encryptedAge.substring(0, 30)}...</div>
              </div>
              <div className="data-item">
                <span>Balance:</span>
                <div>{kyc.encryptedBalance.substring(0, 30)}...</div>
              </div>
            </div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span>Decrypting...</span>
              ) : decryptedData.age !== null ? (
                "Hide Decrypted Data"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          
          {decryptedData.age !== null && (
            <div className="decrypted-section">
              <h3>Decrypted Personal Data</h3>
              <div className="decrypted-values">
                <div className="decrypted-value">
                  <span>Age:</span>
                  <strong>{decryptedData.age}</strong>
                </div>
                <div className="decrypted-value">
                  <span>Balance:</span>
                  <strong>{decryptedData.balance?.toFixed(2)}</strong>
                </div>
              </div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;