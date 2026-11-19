import {describe,expect,it} from "vitest";
import {readyV2AdmissionRefusal} from "../schema-operator-experimental-installer";

const v2={readyProtocol:2 as const},approval={parent:"a".repeat(64)};

describe("READY V2 provisioning admission binding",()=>{
  it("admits only a V2 authority that has an ACTIVE parent revision",()=>{
    expect(readyV2AdmissionRefusal(v2,approval,"a".repeat(64))).toBeNull();
  });
  it("refuses a non-V2 authority",()=>{
    expect(readyV2AdmissionRefusal({},approval,"a".repeat(64))).toBe("NOT_V2");
  });
  it("refuses a first revision or missing ACTIVE parent",()=>{
    expect(readyV2AdmissionRefusal(v2,{parent:null},"a".repeat(64))).toBe("ACTIVE_PARENT");
    expect(readyV2AdmissionRefusal(v2,approval,null)).toBe("ACTIVE_PARENT");
  });
  it("refuses a parent that is not the ACTIVE revision",()=>{
    expect(readyV2AdmissionRefusal(v2,approval,"b".repeat(64))).toBe("ACTIVE_PARENT");
  });
});
