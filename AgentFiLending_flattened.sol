// SPDX-License-Identifier: MIT
// Sources flattened with hardhat v2.28.6 https://hardhat.org

// 

// File @openzeppelin/contracts/utils/Context.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

pragma solidity ^0.8.20;

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}


// File @openzeppelin/contracts/access/Ownable.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (access/Ownable.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * The initial owner is set to the address provided by the deployer. This can
 * later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract Ownable is Context {
    address private _owner;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error OwnableUnauthorizedAccount(address account);

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     */
    constructor(address initialOwner) {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby disabling any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}


// File @openzeppelin/contracts/utils/introspection/IERC165.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (utils/introspection/IERC165.sol)

pragma solidity >=0.4.16;

/**
 * @dev Interface of the ERC-165 standard, as defined in the
 * https://eips.ethereum.org/EIPS/eip-165[ERC].
 *
 * Implementers can declare support of contract interfaces, which can then be
 * queried by others ({ERC165Checker}).
 *
 * For an implementation, see {ERC165}.
 */
interface IERC165 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[ERC section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}


// File @openzeppelin/contracts/interfaces/IERC165.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC165.sol)

pragma solidity >=0.4.16;


// File @openzeppelin/contracts/token/ERC20/IERC20.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/IERC20.sol)

pragma solidity >=0.4.16;

/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */
interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}


// File @openzeppelin/contracts/interfaces/IERC20.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC20.sol)

pragma solidity >=0.4.16;


// File @openzeppelin/contracts/interfaces/IERC1363.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC1363.sol)

pragma solidity >=0.6.2;


/**
 * @title IERC1363
 * @dev Interface of the ERC-1363 standard as defined in the https://eips.ethereum.org/EIPS/eip-1363[ERC-1363].
 *
 * Defines an extension interface for ERC-20 tokens that supports executing code on a recipient contract
 * after `transfer` or `transferFrom`, or code on a spender contract after `approve`, in a single transaction.
 */
interface IERC1363 is IERC20, IERC165 {
    /*
     * Note: the ERC-165 identifier for this interface is 0xb0202a11.
     * 0xb0202a11 ===
     *   bytes4(keccak256('transferAndCall(address,uint256)')) ^
     *   bytes4(keccak256('transferAndCall(address,uint256,bytes)')) ^
     *   bytes4(keccak256('transferFromAndCall(address,address,uint256)')) ^
     *   bytes4(keccak256('transferFromAndCall(address,address,uint256,bytes)')) ^
     *   bytes4(keccak256('approveAndCall(address,uint256)')) ^
     *   bytes4(keccak256('approveAndCall(address,uint256,bytes)'))
     */

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferAndCall(address to, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @param data Additional data with no specified format, sent in call to `to`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the allowance mechanism
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param from The address which you want to send tokens from.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferFromAndCall(address from, address to, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the allowance mechanism
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param from The address which you want to send tokens from.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @param data Additional data with no specified format, sent in call to `to`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferFromAndCall(address from, address to, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens and then calls {IERC1363Spender-onApprovalReceived} on `spender`.
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function approveAndCall(address spender, uint256 value) external returns (bool);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens and then calls {IERC1363Spender-onApprovalReceived} on `spender`.
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     * @param data Additional data with no specified format, sent in call to `spender`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function approveAndCall(address spender, uint256 value, bytes calldata data) external returns (bool);
}


// File @openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.5.0) (token/ERC20/utils/SafeERC20.sol)

pragma solidity ^0.8.20;


/**
 * @title SafeERC20
 * @dev Wrappers around ERC-20 operations that throw on failure (when the token
 * contract returns false). Tokens that return no value (and instead revert or
 * throw on failure) are also supported, non-reverting calls are assumed to be
 * successful.
 * To use this library you can add a `using SafeERC20 for IERC20;` statement to your contract,
 * which allows you to call the safe operations as `token.safeTransfer(...)`, etc.
 */
library SafeERC20 {
    /**
     * @dev An operation with an ERC-20 token failed.
     */
    error SafeERC20FailedOperation(address token);

    /**
     * @dev Indicates a failed `decreaseAllowance` request.
     */
    error SafeERC20FailedDecreaseAllowance(address spender, uint256 currentAllowance, uint256 requestedDecrease);

    /**
     * @dev Transfer `value` amount of `token` from the calling contract to `to`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     */
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        if (!_safeTransfer(token, to, value, true)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Transfer `value` amount of `token` from `from` to `to`, spending the approval given by `from` to the
     * calling contract. If `token` returns no value, non-reverting calls are assumed to be successful.
     */
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        if (!_safeTransferFrom(token, from, to, value, true)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Variant of {safeTransfer} that returns a bool instead of reverting if the operation is not successful.
     */
    function trySafeTransfer(IERC20 token, address to, uint256 value) internal returns (bool) {
        return _safeTransfer(token, to, value, false);
    }

    /**
     * @dev Variant of {safeTransferFrom} that returns a bool instead of reverting if the operation is not successful.
     */
    function trySafeTransferFrom(IERC20 token, address from, address to, uint256 value) internal returns (bool) {
        return _safeTransferFrom(token, from, to, value, false);
    }

    /**
     * @dev Increase the calling contract's allowance toward `spender` by `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     *
     * IMPORTANT: If the token implements ERC-7674 (ERC-20 with temporary allowance), and if the "client"
     * smart contract uses ERC-7674 to set temporary allowances, then the "client" smart contract should avoid using
     * this function. Performing a {safeIncreaseAllowance} or {safeDecreaseAllowance} operation on a token contract
     * that has a non-zero temporary allowance (for that particular owner-spender) will result in unexpected behavior.
     */
    function safeIncreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        forceApprove(token, spender, oldAllowance + value);
    }

    /**
     * @dev Decrease the calling contract's allowance toward `spender` by `requestedDecrease`. If `token` returns no
     * value, non-reverting calls are assumed to be successful.
     *
     * IMPORTANT: If the token implements ERC-7674 (ERC-20 with temporary allowance), and if the "client"
     * smart contract uses ERC-7674 to set temporary allowances, then the "client" smart contract should avoid using
     * this function. Performing a {safeIncreaseAllowance} or {safeDecreaseAllowance} operation on a token contract
     * that has a non-zero temporary allowance (for that particular owner-spender) will result in unexpected behavior.
     */
    function safeDecreaseAllowance(IERC20 token, address spender, uint256 requestedDecrease) internal {
        unchecked {
            uint256 currentAllowance = token.allowance(address(this), spender);
            if (currentAllowance < requestedDecrease) {
                revert SafeERC20FailedDecreaseAllowance(spender, currentAllowance, requestedDecrease);
            }
            forceApprove(token, spender, currentAllowance - requestedDecrease);
        }
    }

    /**
     * @dev Set the calling contract's allowance toward `spender` to `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful. Meant to be used with tokens that require the approval
     * to be set to zero before setting it to a non-zero value, such as USDT.
     *
     * NOTE: If the token implements ERC-7674, this function will not modify any temporary allowance. This function
     * only sets the "standard" allowance. Any temporary allowance will remain active, in addition to the value being
     * set here.
     */
    function forceApprove(IERC20 token, address spender, uint256 value) internal {
        if (!_safeApprove(token, spender, value, false)) {
            if (!_safeApprove(token, spender, 0, true)) revert SafeERC20FailedOperation(address(token));
            if (!_safeApprove(token, spender, value, true)) revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} transferAndCall, with a fallback to the simple {ERC20} transfer if the target has no
     * code. This can be used to implement an {ERC721}-like safe transfer that relies on {ERC1363} checks when
     * targeting contracts.
     *
     * Reverts if the returned value is other than `true`.
     */
    function transferAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            safeTransfer(token, to, value);
        } else if (!token.transferAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} transferFromAndCall, with a fallback to the simple {ERC20} transferFrom if the target
     * has no code. This can be used to implement an {ERC721}-like safe transfer that relies on {ERC1363} checks when
     * targeting contracts.
     *
     * Reverts if the returned value is other than `true`.
     */
    function transferFromAndCallRelaxed(
        IERC1363 token,
        address from,
        address to,
        uint256 value,
        bytes memory data
    ) internal {
        if (to.code.length == 0) {
            safeTransferFrom(token, from, to, value);
        } else if (!token.transferFromAndCall(from, to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} approveAndCall, with a fallback to the simple {ERC20} approve if the target has no
     * code. This can be used to implement an {ERC721}-like safe transfer that rely on {ERC1363} checks when
     * targeting contracts.
     *
     * NOTE: When the recipient address (`to`) has no code (i.e. is an EOA), this function behaves as {forceApprove}.
     * Oppositely, when the recipient address (`to`) has code, this function only attempts to call {ERC1363-approveAndCall}
     * once without retrying, and relies on the returned value to be true.
     *
     * Reverts if the returned value is other than `true`.
     */
    function approveAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            forceApprove(token, to, value);
        } else if (!token.approveAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Imitates a Solidity `token.transfer(to, value)` call, relaxing the requirement on the return value: the
     * return value is optional (but if data is returned, it must not be false).
     *
     * @param token The token targeted by the call.
     * @param to The recipient of the tokens
     * @param value The amount of token to transfer
     * @param bubble Behavior switch if the transfer call reverts: bubble the revert reason or return a false boolean.
     */
    function _safeTransfer(IERC20 token, address to, uint256 value, bool bubble) private returns (bool success) {
        bytes4 selector = IERC20.transfer.selector;

        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(0x00, selector)
            mstore(0x04, and(to, shr(96, not(0))))
            mstore(0x24, value)
            success := call(gas(), token, 0, 0x00, 0x44, 0x00, 0x20)
            // if call success and return is true, all is good.
            // otherwise (not success or return is not true), we need to perform further checks
            if iszero(and(success, eq(mload(0x00), 1))) {
                // if the call was a failure and bubble is enabled, bubble the error
                if and(iszero(success), bubble) {
                    returndatacopy(fmp, 0x00, returndatasize())
                    revert(fmp, returndatasize())
                }
                // if the return value is not true, then the call is only successful if:
                // - the token address has code
                // - the returndata is empty
                success := and(success, and(iszero(returndatasize()), gt(extcodesize(token), 0)))
            }
            mstore(0x40, fmp)
        }
    }

    /**
     * @dev Imitates a Solidity `token.transferFrom(from, to, value)` call, relaxing the requirement on the return
     * value: the return value is optional (but if data is returned, it must not be false).
     *
     * @param token The token targeted by the call.
     * @param from The sender of the tokens
     * @param to The recipient of the tokens
     * @param value The amount of token to transfer
     * @param bubble Behavior switch if the transfer call reverts: bubble the revert reason or return a false boolean.
     */
    function _safeTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 value,
        bool bubble
    ) private returns (bool success) {
        bytes4 selector = IERC20.transferFrom.selector;

        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(0x00, selector)
            mstore(0x04, and(from, shr(96, not(0))))
            mstore(0x24, and(to, shr(96, not(0))))
            mstore(0x44, value)
            success := call(gas(), token, 0, 0x00, 0x64, 0x00, 0x20)
            // if call success and return is true, all is good.
            // otherwise (not success or return is not true), we need to perform further checks
            if iszero(and(success, eq(mload(0x00), 1))) {
                // if the call was a failure and bubble is enabled, bubble the error
                if and(iszero(success), bubble) {
                    returndatacopy(fmp, 0x00, returndatasize())
                    revert(fmp, returndatasize())
                }
                // if the return value is not true, then the call is only successful if:
                // - the token address has code
                // - the returndata is empty
                success := and(success, and(iszero(returndatasize()), gt(extcodesize(token), 0)))
            }
            mstore(0x40, fmp)
            mstore(0x60, 0)
        }
    }

    /**
     * @dev Imitates a Solidity `token.approve(spender, value)` call, relaxing the requirement on the return value:
     * the return value is optional (but if data is returned, it must not be false).
     *
     * @param token The token targeted by the call.
     * @param spender The spender of the tokens
     * @param value The amount of token to transfer
     * @param bubble Behavior switch if the transfer call reverts: bubble the revert reason or return a false boolean.
     */
    function _safeApprove(IERC20 token, address spender, uint256 value, bool bubble) private returns (bool success) {
        bytes4 selector = IERC20.approve.selector;

        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(0x00, selector)
            mstore(0x04, and(spender, shr(96, not(0))))
            mstore(0x24, value)
            success := call(gas(), token, 0, 0x00, 0x44, 0x00, 0x20)
            // if call success and return is true, all is good.
            // otherwise (not success or return is not true), we need to perform further checks
            if iszero(and(success, eq(mload(0x00), 1))) {
                // if the call was a failure and bubble is enabled, bubble the error
                if and(iszero(success), bubble) {
                    returndatacopy(fmp, 0x00, returndatasize())
                    revert(fmp, returndatasize())
                }
                // if the return value is not true, then the call is only successful if:
                // - the token address has code
                // - the returndata is empty
                success := and(success, and(iszero(returndatasize()), gt(extcodesize(token), 0)))
            }
            mstore(0x40, fmp)
        }
    }
}


// File @openzeppelin/contracts/utils/StorageSlot.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (utils/StorageSlot.sol)
// This file was procedurally generated from scripts/generate/templates/StorageSlot.js.

pragma solidity ^0.8.20;

/**
 * @dev Library for reading and writing primitive types to specific storage slots.
 *
 * Storage slots are often used to avoid storage conflict when dealing with upgradeable contracts.
 * This library helps with reading and writing to such slots without the need for inline assembly.
 *
 * The functions in this library return Slot structs that contain a `value` member that can be used to read or write.
 *
 * Example usage to set ERC-1967 implementation slot:
 * ```solidity
 * contract ERC1967 {
 *     // Define the slot. Alternatively, use the SlotDerivation library to derive the slot.
 *     bytes32 internal constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
 *
 *     function _getImplementation() internal view returns (address) {
 *         return StorageSlot.getAddressSlot(_IMPLEMENTATION_SLOT).value;
 *     }
 *
 *     function _setImplementation(address newImplementation) internal {
 *         require(newImplementation.code.length > 0);
 *         StorageSlot.getAddressSlot(_IMPLEMENTATION_SLOT).value = newImplementation;
 *     }
 * }
 * ```
 *
 * TIP: Consider using this library along with {SlotDerivation}.
 */
library StorageSlot {
    struct AddressSlot {
        address value;
    }

    struct BooleanSlot {
        bool value;
    }

    struct Bytes32Slot {
        bytes32 value;
    }

    struct Uint256Slot {
        uint256 value;
    }

    struct Int256Slot {
        int256 value;
    }

    struct StringSlot {
        string value;
    }

    struct BytesSlot {
        bytes value;
    }

    /**
     * @dev Returns an `AddressSlot` with member `value` located at `slot`.
     */
    function getAddressSlot(bytes32 slot) internal pure returns (AddressSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `BooleanSlot` with member `value` located at `slot`.
     */
    function getBooleanSlot(bytes32 slot) internal pure returns (BooleanSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Bytes32Slot` with member `value` located at `slot`.
     */
    function getBytes32Slot(bytes32 slot) internal pure returns (Bytes32Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Uint256Slot` with member `value` located at `slot`.
     */
    function getUint256Slot(bytes32 slot) internal pure returns (Uint256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Int256Slot` with member `value` located at `slot`.
     */
    function getInt256Slot(bytes32 slot) internal pure returns (Int256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `StringSlot` with member `value` located at `slot`.
     */
    function getStringSlot(bytes32 slot) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `StringSlot` representation of the string storage pointer `store`.
     */
    function getStringSlot(string storage store) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }

    /**
     * @dev Returns a `BytesSlot` with member `value` located at `slot`.
     */
    function getBytesSlot(bytes32 slot) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `BytesSlot` representation of the bytes storage pointer `store`.
     */
    function getBytesSlot(bytes storage store) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }
}


// File @openzeppelin/contracts/utils/ReentrancyGuard.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.5.0) (utils/ReentrancyGuard.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If EIP-1153 (transient storage) is available on the chain you're deploying at,
 * consider using {ReentrancyGuardTransient} instead.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 *
 * IMPORTANT: Deprecated. This storage-based reentrancy guard will be removed and replaced
 * by the {ReentrancyGuardTransient} variant in v6.0.
 *
 * @custom:stateless
 */
abstract contract ReentrancyGuard {
    using StorageSlot for bytes32;

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ReentrancyGuard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant REENTRANCY_GUARD_STORAGE =
        0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    constructor() {
        _reentrancyGuardStorageSlot().getUint256Slot().value = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    /**
     * @dev A `view` only version of {nonReentrant}. Use to block view functions
     * from being called, preventing reading from inconsistent contract state.
     *
     * CAUTION: This is a "view" modifier and does not change the reentrancy
     * status. Use it only on view functions. For payable or non-payable functions,
     * use the standard {nonReentrant} modifier instead.
     */
    modifier nonReentrantView() {
        _nonReentrantBeforeView();
        _;
    }

    function _nonReentrantBeforeView() private view {
        if (_reentrancyGuardEntered()) {
            revert ReentrancyGuardReentrantCall();
        }
    }

    function _nonReentrantBefore() private {
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        _nonReentrantBeforeView();

        // Any calls to nonReentrant after this point will fail
        _reentrancyGuardStorageSlot().getUint256Slot().value = ENTERED;
    }

    function _nonReentrantAfter() private {
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _reentrancyGuardStorageSlot().getUint256Slot().value = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _reentrancyGuardStorageSlot().getUint256Slot().value == ENTERED;
    }

    function _reentrancyGuardStorageSlot() internal pure virtual returns (bytes32) {
        return REENTRANCY_GUARD_STORAGE;
    }
}


// File contracts/AgentFiLending.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;




/**
 * AgentFiLending — on-chain core for all lending/borrowing.
 *
 * Design rules:
 *  - Every loan lifecycle event (request, fund, repay, default, liquidate) is on-chain only.
 *  - Collateral is held in this contract. Released on clean repay or seized on default.
 *  - Reputation deltas are emitted as events; the off-chain PeosFi oracle reads them
 *    and writes the updated score back on-chain via setReputation().
 *  - The platform backend (2-of-2 multisig co-signer) calls fundLoan() after the
 *    off-chain matcher pairs a lender with a borrower.
 *  - No admin can touch user funds except through the defined loan lifecycle.
 */
contract AgentFiLending is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ────────────────────────────────────────────────────────────────

    enum LoanStatus { None, Requested, Active, Repaid, Defaulted, Liquidated }

    struct Loan {
        uint256 loanId;
        address borrower;           // agent multisig wallet
        address lender;             // agent multisig wallet
        uint256 principal;          // USDC (6 decimals)
        uint256 collateral;         // USDC locked from borrower
        uint256 interestAmount;     // fixed at origination
        uint256 dueAt;              // unix timestamp
        uint256 repaidAt;
        LoanStatus status;
        bytes32 borrowerEns;        // keccak256 of ENS name, for indexing
        bytes32 lenderEns;
    }

    struct AgentRep {
        uint8 score;                // 0–50
        uint32 lastActivityAt;
        uint32 totalLoans;
        uint32 cleanRepayments;
        uint32 defaults;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;

    uint256 public nextLoanId = 1;
    mapping(uint256 => Loan) public loans;
    mapping(address => AgentRep) public agentRep;

    // agentWallet → list of loan IDs (as borrower or lender)
    mapping(address => uint256[]) public agentLoansAsBorrower;
    mapping(address => uint256[]) public agentLoansAsLender;

    // ENS identity bindings (set at registration, immutable)
    // ensNameHash = keccak256(abi.encodePacked(ensName))
    mapping(bytes32 => address) public ensNameToWallet;
    mapping(address => bytes32) public walletToEnsName;

    // platform backend address — signs alongside agent key (2-of-2)
    address public platformSigner;

    // USDC decimals = 6
    uint256 public constant USDC_DECIMALS = 1e6;
    uint256 public constant MAX_LOAN_USDC = 1000 * 1e6;    // 1000 USDC
    uint256 public constant MIN_LOAN_USDC = 10 * 1e6;      // 10 USDC
    uint256 public constant LOAN_DURATION = 7 days;
    uint8 public constant REP_MAX = 50;
    uint8 public constant REP_NEW_AGENT = 25;
    uint8 public constant REP_ZERO_COLLATERAL = 35;         // C₀ — derived threshold

    // grace period before a loan can be marked defaulted
    uint256 public constant DEFAULT_GRACE = 1 days;

    // ─── Events ───────────────────────────────────────────────────────────────

    event LoanRequested(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed lender,
        uint256 principal,
        uint256 collateral,
        uint256 interestAmount,
        uint256 dueAt
    );
    event LoanFunded(uint256 indexed loanId, uint256 fundedAt);
    event LoanRepaid(uint256 indexed loanId, uint256 repaidAt, bool withProfit);
    event LoanDefaulted(uint256 indexed loanId, uint256 defaultedAt);
    event CollateralSeized(uint256 indexed loanId, address indexed lender, uint256 amount);
    event ReputationUpdated(address indexed agent, uint8 oldScore, uint8 newScore, string reason);
    event AgentRegistered(address indexed agent, uint8 initialScore, bytes32 ensNameHash);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _usdc, address _platformSigner) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        platformSigner = _platformSigner;
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyPlatform() {
        require(msg.sender == platformSigner, "AgentFi: caller is not platform");
        _;
    }

    modifier loanExists(uint256 loanId) {
        require(loans[loanId].status != LoanStatus.None, "AgentFi: loan not found");
        _;
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    /**
     * Called by platform when a new agent is created.
     * Sets initial reputation score and binds the ENS subdomain to the agent wallet.
     * ensNameHash = keccak256(abi.encodePacked("agent1.alice.agentfi.eth")).
     * Agent wallet must be the 2-of-2 multisig address.
     */
    function registerAgent(address agent, uint8 initialScore, bytes32 ensNameHash) external onlyPlatform {
        require(agentRep[agent].lastActivityAt == 0, "AgentFi: already registered");
        require(initialScore <= REP_ZERO_COLLATERAL, "AgentFi: initial score too high");
        require(ensNameHash != bytes32(0), "AgentFi: ensNameHash cannot be zero");
        require(ensNameToWallet[ensNameHash] == address(0), "AgentFi: ENS name already registered");

        agentRep[agent] = AgentRep({
            score: initialScore,
            lastActivityAt: uint32(block.timestamp),
            totalLoans: 0,
            cleanRepayments: 0,
            defaults: 0
        });

        // Bind ENS name hash ↔ wallet address on-chain
        ensNameToWallet[ensNameHash] = agent;
        walletToEnsName[agent] = ensNameHash;

        emit AgentRegistered(agent, initialScore, ensNameHash);
    }

    /**
     * Verify that a wallet address is bound to the given ENS name hash on-chain.
     * Returns true only if both directions of the mapping agree.
     * Callable by anyone — used by the backend and external auditors.
     */
    function verifyEns(bytes32 ensNameHash, address wallet) external view returns (bool) {
        return ensNameToWallet[ensNameHash] == wallet && walletToEnsName[wallet] == ensNameHash;
    }

    /**
     * Look up the wallet address for a given ENS name hash.
     */
    function walletForEns(bytes32 ensNameHash) external view returns (address) {
        return ensNameToWallet[ensNameHash];
    }

    /**
     * Look up the ENS name hash bound to a wallet.
     */
    function ensForWallet(address wallet) external view returns (bytes32) {
        return walletToEnsName[wallet];
    }

    // ─── Reputation read helpers ───────────────────────────────────────────────

    /**
     * Collateral required for a given rep score and principal.
     * collateral% = max(0, (35 - rep) * 2.86)
     * Returns collateral amount in USDC (6 decimals).
     */
    function requiredCollateral(address borrower, uint256 principal)
        public view returns (uint256)
    {
        uint8 rep = agentRep[borrower].score;
        if (rep >= REP_ZERO_COLLATERAL) return 0;
        // (35 - rep) * 2.86 / 100 * principal
        // use integer: multiply by 286, divide by 10000
        uint256 pct = (uint256(REP_ZERO_COLLATERAL - rep) * 286);
        return (principal * pct) / 10000;
    }

    /**
     * Maximum loan size for a given agent.
     * maxLoan = rep * 20 USDC, capped at MAX_LOAN_USDC.
     */
    function maxLoanSize(address borrower) public view returns (uint256) {
        uint8 rep = agentRep[borrower].score;
        uint256 cap = uint256(rep) * 20 * USDC_DECIMALS;
        return cap > MAX_LOAN_USDC ? MAX_LOAN_USDC : cap;
    }

    // ─── Loan lifecycle ───────────────────────────────────────────────────────

    /**
     * Step 1: Platform creates the loan record after off-chain matching.
     * Borrower must have approved this contract to pull collateral.
     * Lender must have approved this contract to pull principal.
     *
     * interestAmount is computed off-chain:
     *   interest = principal * rate (rate = max(0.5%, 3.5% - rep*0.06%) / cyclesPerYear)
     *
     * Called by platformSigner (the backend co-signer key).
     */
    function requestLoan(
        address borrower,
        address lender,
        uint256 principal,
        uint256 interestAmount,
        bytes32 borrowerEns,
        bytes32 lenderEns
    ) external onlyPlatform nonReentrant returns (uint256 loanId) {
        // ── validations ──
        require(agentRep[borrower].lastActivityAt > 0, "AgentFi: borrower not registered");
        require(agentRep[lender].lastActivityAt > 0,   "AgentFi: lender not registered");
        require(borrower != lender, "AgentFi: self-loan not allowed");
        require(principal >= MIN_LOAN_USDC, "AgentFi: below minimum loan");
        require(principal <= maxLoanSize(borrower), "AgentFi: exceeds rep-based cap");

        // ── collateral calculation ──
        uint256 collateral = requiredCollateral(borrower, principal);

        // ── pull collateral from borrower (0 if rep >= 35) ──
        if (collateral > 0) {
            usdc.safeTransferFrom(borrower, address(this), collateral);
        }

        // ── create loan record ──
        loanId = nextLoanId++;
        loans[loanId] = Loan({
            loanId: loanId,
            borrower: borrower,
            lender: lender,
            principal: principal,
            collateral: collateral,
            interestAmount: interestAmount,
            dueAt: block.timestamp + LOAN_DURATION,
            repaidAt: 0,
            status: LoanStatus.Requested,
            borrowerEns: borrowerEns,
            lenderEns: lenderEns
        });

        agentLoansAsBorrower[borrower].push(loanId);
        agentLoansAsLender[lender].push(loanId);
        agentRep[borrower].totalLoans++;
        agentRep[borrower].lastActivityAt = uint32(block.timestamp);

        emit LoanRequested(
            loanId, borrower, lender, principal, collateral, interestAmount,
            loans[loanId].dueAt
        );
    }

    /**
     * Step 2: Platform pulls principal from lender and sends to borrower.
     * Must be called immediately after requestLoan (same tx block window acceptable).
     * Lender must have approved this contract for principal amount.
     */
    function fundLoan(uint256 loanId)
        external onlyPlatform nonReentrant loanExists(loanId)
    {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Requested, "AgentFi: loan not in Requested state");

        // pull principal from lender → send to borrower
        usdc.safeTransferFrom(loan.lender, loan.borrower, loan.principal);

        loan.status = LoanStatus.Active;
        agentRep[loan.lender].lastActivityAt = uint32(block.timestamp);

        emit LoanFunded(loanId, block.timestamp);
    }

    /**
     * Step 3a: Borrower repays principal + interest.
     * Borrower must have approved this contract for (principal + interestAmount).
     * Collateral is returned to borrower on clean repay.
     * Called by the borrower agent's multisig (agent key + platform co-sign).
     */
    function repayLoan(uint256 loanId, uint256 profitGenerated)
        external nonReentrant loanExists(loanId)
    {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "AgentFi: loan not active");
        require(msg.sender == loan.borrower, "AgentFi: only borrower can repay");
        require(block.timestamp <= loan.dueAt + DEFAULT_GRACE, "AgentFi: grace period passed, use liquidate");

        uint256 repayAmount = loan.principal + loan.interestAmount;

        // pull repayment from borrower → forward to lender
        usdc.safeTransferFrom(loan.borrower, loan.lender, repayAmount);

        // return collateral to borrower if any was locked
        if (loan.collateral > 0) {
            usdc.safeTransfer(loan.borrower, loan.collateral);
        }

        loan.status = LoanStatus.Repaid;
        loan.repaidAt = block.timestamp;

        // ── reputation update ──
        bool isLate = block.timestamp > loan.dueAt;
        bool withProfit = profitGenerated > 0;

        _updateRepOnRepay(loan.borrower, isLate, withProfit);

        emit LoanRepaid(loanId, block.timestamp, withProfit);
    }

    /**
     * Step 3b: Partial repayment — borrower returns what they can.
     * Platform calls this when full repayment fails but borrower cooperates.
     * Remainder is covered from collateral. Rep penalty applied.
     */
    function repayPartial(uint256 loanId, uint256 partialAmount)
        external onlyPlatform nonReentrant loanExists(loanId)
    {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "AgentFi: loan not active");

        uint256 totalOwed = loan.principal + loan.interestAmount;
        require(partialAmount < totalOwed, "AgentFi: use repayLoan for full amount");
        require(partialAmount > 0, "AgentFi: zero partial");

        // pull what borrower has
        if (partialAmount > 0) {
            usdc.safeTransferFrom(loan.borrower, loan.lender, partialAmount);
        }

        // cover remainder from collateral (up to what's available)
        uint256 shortfall = totalOwed - partialAmount;
        uint256 collateralCover = loan.collateral >= shortfall ? shortfall : loan.collateral;
        uint256 remainder = shortfall - collateralCover;

        if (collateralCover > 0) {
            usdc.safeTransfer(loan.lender, collateralCover);
        }
        // if remainder > 0, lender takes a haircut — reflected in borrower rep

        loan.status = LoanStatus.Defaulted;
        loan.repaidAt = block.timestamp;

        _updateRepOnPartial(loan.borrower, partialAmount, totalOwed);

        emit LoanDefaulted(loanId, block.timestamp);
    }

    /**
     * Step 3c: Liquidation — called by platform after grace period expires.
     * Seizes collateral, sends to lender. Rep penalty = full default.
     */
    function liquidateLoan(uint256 loanId)
        external onlyPlatform nonReentrant loanExists(loanId)
    {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "AgentFi: loan not active");
        require(
            block.timestamp > loan.dueAt + DEFAULT_GRACE,
            "AgentFi: grace period not passed"
        );

        // seize collateral → send to lender
        if (loan.collateral > 0) {
            usdc.safeTransfer(loan.lender, loan.collateral);
            emit CollateralSeized(loanId, loan.lender, loan.collateral);
        }

        loan.status = LoanStatus.Liquidated;

        _updateRepOnDefault(loan.borrower);

        emit LoanDefaulted(loanId, block.timestamp);
    }

    // ─── Reputation internal logic ─────────────────────────────────────────────

    function _updateRepOnRepay(address borrower, bool isLate, bool withProfit) internal {
        AgentRep storage rep = agentRep[borrower];
        uint8 old = rep.score;
        string memory reason;

        if (!isLate && withProfit) {
            rep.score = _addCapped(rep.score, 2);
            reason = "on_time_with_profit";
        } else if (!isLate) {
            rep.score = _addCapped(rep.score, 1);
            reason = "on_time_no_profit";
        } else {
            rep.score = _subFloored(rep.score, 2);
            reason = "late_repayment";
        }

        rep.cleanRepayments++;
        rep.lastActivityAt = uint32(block.timestamp);
        emit ReputationUpdated(borrower, old, rep.score, reason);
    }

    function _updateRepOnPartial(address borrower, uint256 paid, uint256 owed) internal {
        AgentRep storage rep = agentRep[borrower];
        uint8 old = rep.score;
        // < 80% paid = −4, else −2
        uint8 penalty = (paid * 100 / owed) < 80 ? 4 : 2;
        rep.score = _subFloored(rep.score, penalty);
        rep.defaults++;
        rep.lastActivityAt = uint32(block.timestamp);
        emit ReputationUpdated(borrower, old, rep.score, "partial_repayment");
    }

    function _updateRepOnDefault(address borrower) internal {
        AgentRep storage rep = agentRep[borrower];
        uint8 old = rep.score;
        rep.score = _subFloored(rep.score, 10);
        rep.defaults++;
        rep.lastActivityAt = uint32(block.timestamp);
        emit ReputationUpdated(borrower, old, rep.score, "default");
    }

    function _addCapped(uint8 score, uint8 delta) internal pure returns (uint8) {
        uint16 result = uint16(score) + delta;
        return result > REP_MAX ? REP_MAX : uint8(result);
    }

    function _subFloored(uint8 score, uint8 delta) internal pure returns (uint8) {
        return score > delta ? score - delta : 0;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /**
     * Platform can set rep directly — used for ZK vouching (+8) and decay.
     * Cannot set above 50 or below 0.
     */
    function setReputation(address agent, uint8 newScore, string calldata reason)
        external onlyPlatform
    {
        require(newScore <= REP_MAX, "AgentFi: score exceeds max");
        uint8 old = agentRep[agent].score;
        agentRep[agent].score = newScore;
        agentRep[agent].lastActivityAt = uint32(block.timestamp);
        emit ReputationUpdated(agent, old, newScore, reason);
    }

    function setPlatformSigner(address newSigner) external onlyOwner {
        platformSigner = newSigner;
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    function getAgentRep(address agent) external view returns (AgentRep memory) {
        return agentRep[agent];
    }

    function getBorrowerLoans(address agent) external view returns (uint256[] memory) {
        return agentLoansAsBorrower[agent];
    }

    function getLenderLoans(address agent) external view returns (uint256[] memory) {
        return agentLoansAsLender[agent];
    }
}
