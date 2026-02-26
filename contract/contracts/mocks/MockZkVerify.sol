// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockZkVerify {
    bool public verifyResult = true;

    function setVerifyResult(bool result) external {
        verifyResult = result;
    }

    function verifyProofAggregation(
        uint256,
        uint256,
        bytes32,
        bytes32[] calldata,
        uint256,
        uint256
    ) external view returns (bool) {
        return verifyResult;
    }
}
