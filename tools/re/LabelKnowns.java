// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ghidra headless: apply everything we know as PERSISTENT labels so it compounds across passes.
// Convention: function name = "<conf>_<Name>", conf in {hi, md, lo} (confidence). A plate comment
// carries the evidence. Re-run any time we learn more; edit the LABELS list. Saves the DB.
//   analyzeHeadless <proj> snowrunner -process snowrunner-fixed.bin -noanalysis -postScript LabelKnowns.java
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.SourceType;

public class LabelKnowns extends GhidraScript {
    Address base; FunctionManager fm;

    void label(long rva, String conf, String name, String evidence) {
        Function f = fm.getFunctionContaining(base.add(rva));
        if (f == null) { println("// NO FUNCTION @ rva 0x" + Long.toHexString(rva) + " (" + name + ")"); return; }
        try {
            f.setName(conf + "_" + name, SourceType.USER_DEFINED);
            f.setComment("CONFIDENCE " + conf.toUpperCase() + " -- " + evidence);   // plate comment
            println("// " + conf + "_" + name + " @ rva 0x" + Long.toHexString(rva));
        } catch (Exception e) { println("// err " + name + ": " + e); }
    }

    public void run() throws Exception {
        base = currentProgram.getImageBase();
        fm = currentProgram.getFunctionManager();

        // ---- audio path ----
        label(0xdfb2f0L, "hi", "SetVoiceVolPitch", "voice vtable +0x60=SetVolume(param3), +0xd0=SetFrequencyRatio(param4); guarded by byte DAT@0x2aa19a4");
        label(0xdff1e0L, "hi", "UpdateSound", "sole caller of SetVoiceVolPitch; pitch = *(SoundObj+0x58), does 3D distance volume attenuation");
        // ---- data / config parsers ----
        label(0xd072c0L, "hi", "ParseGearbox_AngVel", "reads ReverseGear/HighGear/AngVel XML strings into the gearbox caps struct");
        label(0xd06190L, "md", "ParseEngine_MaxDeltaAngVel", "reads MaxDeltaAngVel engine XML string");
        label(0xe5c5f0L, "md", "ShaderBind_wheelParams", "references g_fAngVel/g_wheelParams/g_softParams shader-uniform name strings (reflection/binding, not per-frame writer)");
        label(0x9ddcc0L, "lo", "GetTruckControl", "sole xref of TRUCK_CONTROL global @0x2A8EDD8; tiny getter");
        // ---- drivetrain / shifting ----
        label(0xc404f0L, "hi", "DrivetrainUpdate_ApplyGear", "big float drivetrain update; copies commanded gear TA+0x74 -> current TA+0x70 when they differ (the shift apply @0xc4074e). Manual shift = set IsInAutoMode(+0x3C)=0 + write +0x74");
        label(0xc3fe20L, "md", "DrivetrainWheelGearSync", "per-frame; iterates wheels (veh+0x200); writes the gear field every frame (@0xc404cb). Copies drivetrain gear state -> TA+0x70. SOLE caller of DrivetrainUpdate_ApplyGear. Traction/torque distribution loop; shift-threshold compare lives here (uses lVar+0xfa0/+0xf9c gear ints, DAT_ consts TBD).");
        label(0xd72640L, "hi", "GetGearData", "GetGearData(vehicle, gear, out torque, out thrDn, out cap, out thrUp, out distrib). cap = caps[gear] (gear's OWN index, NOT gear+1) at [[TA+0x58]][gear]; reverse=caps[0]. out_torque = Torque(TA+0x50)/sqrt(cap*k) (mechanical advantage, lower gear=more torque). thrDn=cap*ec18-ecdc, thrUp=2*cap+ed00 (cap-linear shift thresholds). HIGH gear (==GetMaxGear+1) special-cased: torque=Torque*ecb0, thrDn=0.35, cap=cap+ecdc.");
        label(0xd71750L, "hi", "Gearbox_PowerCoefPtr", "returns &(TruckAction+0x38) = PowerCoef. In DrivetrainUpdate this scalar SCALES the gear cap+thresholds (effective_cap = cap * PowerCoef) — it is the L/L+/L- power multiplier, NOT a final-drive constant. So cap->speed scale difference between trucks is NOT explained here; the per-truck scale is the current-output-angvel source (still TBD) that gets compared to caps[gear].");
        label(0xd72300L, "hi", "GetMaxGear", "maxGear = ((*(TA+0x58 end) - *(TA+0x58 begin)) >> 2) - 2 = capsCount - 2. Caps layout [reverse, g1..gN, high]; high index = maxGear+1.");
        label(0xd71850L, "hi", "GetWheelPhys", "GetWheelPhys(drivetrain, i) = *(*(drivetrain+0x200)[i] + 0x2c8) -> the per-wheel PHYSICS object (has Havok body ptr @+0x18, angvel fields below). Wheel container = (drivetrain+0x200)[i] = Vehicle+0x200[i]; container+0x16c is a flag (=1.0), NOT angvel. LIVE-confirmed: *(Vehicle+0x200[i]+0x2c8)+0x174 reads the tire angvel.");
        label(0xc26160L, "hi", "WheelPhysUpdate_AngVel", "per-wheel physics update (called per wheel from DrivetrainWheelGearSync). Computes the TRUE wheel angular velocity: phys+0x174 = Havok body angVel(bodyPtr@phys+0x18, +0x240/+0x244/+0x248) DOTTED with the wheel spin axis (spin-axis projection, signed, no chassis-rock noise); phys+0x16c = EMA-smoothed +0x174; phys+0x170 = body linVel(+0x230/+0x234/+0x238) . axis = wheel ground/contact speed. This is the wheelspin-aware tire angvel -- the RPM numerator, per wheel by identity. LIVE-confirmed (WPHYS diag, 8-wheeler): raw174 tracks speed while gripping (~= lin170/radius, radius~0.6m), signed (negative in reverse), carries per-wheel slip, rests at 0. Wired into RPM as g_wav (tools/dev/src).");
        // ---- physics (Havok) ----
        label(0x195f0d0L, "hi", "Havok_ApplyImpulse", "inverse mass(+0xdc) + inverse-inertia matrix(+0x20..0x48); accumulates linVel(+0xe0..) and angVel(+0xf0..) on a rigid body. Caught writing chassis linVel by watchpoint");

        try { createLabel(base.add(0x2A8EDD8L), "g_TruckControl", true); println("// data: g_TruckControl @ 0x2A8EDD8"); } catch (Exception e) {}
        println("// labeling pass complete");
    }
}
