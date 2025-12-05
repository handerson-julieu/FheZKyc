pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FheZKycFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error BatchNotClosed();
    error InvalidCooldown();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();
    error InvalidBatchId();
    error UserAlreadyInBatch();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event UserSubmitted(uint256 indexed batchId, address indexed user);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 userAge);

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    struct UserEncryptedData {
        euint32 encryptedAge;
        euint32 encryptedCountryCode; // Example: 1 for USA, 44 for UK
    }

    mapping(address => bool) public isProvider;
    mapping(uint256 => mapping(address => UserEncryptedData)) public encryptedUserData;
    mapping(uint256 => mapping(address => bool)) public userInBatch;
    mapping(uint256 => bool) public batchClosed;
    mapping(uint256 => DecryptionContext) public decryptionContexts;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    address public owner;
    bool public paused;
    uint256 public cooldownSeconds;
    uint256 public currentBatchId;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier submissionCooldown(address _user) {
        if (block.timestamp < lastSubmissionTime[_user] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier decryptionRequestCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        cooldownSeconds = 60; // Default cooldown: 60 seconds
        currentBatchId = 1; // Start with batch 1
    }

    function addProvider(address _provider) external onlyOwner {
        isProvider[_provider] = true;
        emit ProviderAdded(_provider);
    }

    function removeProvider(address _provider) external onlyOwner {
        isProvider[_provider] = false;
        emit ProviderRemoved(_provider);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner {
        if (_cooldownSeconds == 0) revert InvalidCooldown();
        emit CooldownSet(cooldownSeconds, _cooldownSeconds);
        cooldownSeconds = _cooldownSeconds;
    }

    function openNewBatch() external onlyOwner {
        currentBatchId++;
        // New batch is open by default, no need to set batchClosed[currentBatchId] = false explicitly
        emit BatchOpened(currentBatchId);
    }

    function closeCurrentBatch() external onlyOwner {
        if (batchClosed[currentBatchId]) revert BatchClosed();
        batchClosed[currentBatchId] = true;
        emit BatchClosed(currentBatchId);
    }

    function submitUserEncryptedData(
        address _user,
        euint32 _encryptedAge,
        euint32 _encryptedCountryCode
    ) external onlyProvider whenNotPaused submissionCooldown(_user) {
        if (batchClosed[currentBatchId]) revert BatchClosed();
        if (userInBatch[currentBatchId][_user]) revert UserAlreadyInBatch();

        _initIfNeeded(_encryptedAge);
        _initIfNeeded(_encryptedCountryCode);

        encryptedUserData[currentBatchId][_user] = UserEncryptedData(_encryptedAge, _encryptedCountryCode);
        userInBatch[currentBatchId][_user] = true;
        lastSubmissionTime[_user] = block.timestamp;

        emit UserSubmitted(currentBatchId, _user);
    }

    function requestAgeVerification(uint256 _batchId, address _user)
        external
        onlyProvider
        whenNotPaused
        decryptionRequestCooldown
    {
        if (_batchId == 0 || _batchId > currentBatchId) revert InvalidBatchId();
        if (!userInBatch[_batchId][_user]) revert NotInitialized(); // Or a more specific error

        UserEncryptedData storage data = encryptedUserData[_batchId][_user];
        _initIfNeeded(data.encryptedAge);

        // 1. Prepare Ciphertexts
        // For age verification, we only need the encrypted age.
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(data.encryptedAge);

        // 2. Compute State Hash
        bytes32 stateHash = _hashCiphertexts(cts);

        // 3. Request Decryption
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        // 4. Store Context
        decryptionContexts[requestId] = DecryptionContext({
            batchId: _batchId,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, _batchId);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        DecryptionContext storage ctx = decryptionContexts[requestId];

        // a. Replay Guard
        if (ctx.processed) revert ReplayDetected();

        // b. State Verification
        // Rebuild cts array in the exact same order as in requestAgeVerification
        UserEncryptedData storage data = encryptedUserData[ctx.batchId][msg.sender]; // msg.sender is the provider who initiated
        _initIfNeeded(data.encryptedAge); // Ensure it's initialized

        bytes32[] memory currentCts = new bytes32[](1);
        currentCts[0] = FHE.toBytes32(data.encryptedAge);

        bytes32 currentHash = _hashCiphertexts(currentCts);
        if (currentHash != ctx.stateHash) {
            revert StateMismatch();
        }

        // c. Proof Verification
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert InvalidProof();
        }

        // d. Decode & Finalize
        // Cleartexts are expected in the same order as cts
        uint32 age = abi.decode(cleartexts, (uint32));

        // Example: Emit event with the decrypted age (for demo purposes, real zk-KYC would use ZKP)
        emit DecryptionCompleted(requestId, ctx.batchId, age);

        ctx.processed = true;
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 _val) internal pure {
        if (!_val.isInitialized()) {
            revert NotInitialized();
        }
    }

    function _initIfNeeded(ebool _val) internal pure {
        if (!_val.isInitialized()) {
            revert NotInitialized();
        }
    }
}