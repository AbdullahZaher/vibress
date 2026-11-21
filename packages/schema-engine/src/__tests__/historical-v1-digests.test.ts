import {describe,expect,it} from "vitest";
import {asApplicationId,asInstallationId} from "@vibress/platform-kernel";
import {canonicalSchemaDigest,compileResourceSchema} from "../schema";
import {createSchemaManifest} from "../planning";
import {compilePortableProvisioningIdentity,compileProvisioningContract,PROVISIONING_PROFILE} from "../physical-contract";

const scope={applicationId:asApplicationId("extended-types"),installationId:asInstallationId("installation-extended")};

describe("historical CORE V1 digest preservation",()=>{
  it("keeps null-to-first manifest, canonical, physical and portable digests identical to baseline 96442be",()=>{
    const manifest=createSchemaManifest(compileResourceSchema([{...scope,id:"invoices",ownership:"tenant",fields:[
      {id:"code",type:"text",required:true},{id:"done",type:"boolean",required:true},{id:"due",type:"datetime",required:false},
    ]}],scope));
    const physical=compileProvisioningContract(manifest,scope),portable=compilePortableProvisioningIdentity(null,manifest,scope);
    expect(manifest.digest).toBe("9731a2fcf22f850e7ff752a4e1e32b4248c310cb0bdf068b782f44fc6aed38db");
    expect(canonicalSchemaDigest(manifest.canonicalIr)).toBe("796e2fff6158eee0aa7d1857823b84a7f4d66439a8c7c669cd1ad74bca61cbb0");
    expect(physical.profile).toBe(PROVISIONING_PROFILE);
    expect(physical.digest).toBe("dae243efb5170374dd29cdfdc02144fc942855e5c95d8f4ee1dac4fe25f1c81c");
    expect(portable.contentDigest).toBe("690ec3689e0462c837eefb8b925f8f39c987e5f4effd6e364073ece4503e0a2d");
  });
});
