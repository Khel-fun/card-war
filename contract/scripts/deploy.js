const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying with:', deployer.address);

  const CardWarRegistry = await hre.ethers.getContractFactory('CardWarRegistry');
  const registry = await CardWarRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log('CardWarRegistry deployed to:', address);

  const zkVerifyAddress = process.env.ZKVERIFY_CONTRACT_ADDRESS;
  if (zkVerifyAddress) {
    const tx = await registry.updateZkVerify(zkVerifyAddress);
    await tx.wait();
    console.log('Configured zkVerify address:', zkVerifyAddress);
  }

  const deploymentInfo = {
    network: hre.network.name,
    address,
    zkVerifyAddress: zkVerifyAddress || null,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${hre.network.name}.json`),
    JSON.stringify(deploymentInfo, null, 2)
  );

  const frontendAbiDir = path.join(__dirname, '../../frontend/src/contracts');
  if (!fs.existsSync(frontendAbiDir)) fs.mkdirSync(frontendAbiDir, { recursive: true });

  const artifact = await hre.artifacts.readArtifact('CardWarRegistry');
  fs.writeFileSync(
    path.join(frontendAbiDir, 'CardWarRegistry.json'),
    JSON.stringify({ address, abi: artifact.abi }, null, 2)
  );

  console.log('ABI + address written to frontend/src/contracts/CardWarRegistry.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
