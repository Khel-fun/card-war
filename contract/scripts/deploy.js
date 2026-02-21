const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying with:', deployer.address);

  const CardWarEscrow = await hre.ethers.getContractFactory('CardWarEscrow');
  const escrow = await CardWarEscrow.deploy();
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log('CardWarEscrow deployed to:', address);

  const deploymentInfo = {
    network: hre.network.name,
    address,
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

  const artifact = await hre.artifacts.readArtifact('CardWarEscrow');
  fs.writeFileSync(
    path.join(frontendAbiDir, 'CardWarEscrow.json'),
    JSON.stringify({ address, abi: artifact.abi }, null, 2)
  );

  console.log('ABI + address written to frontend/src/contracts/CardWarEscrow.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
