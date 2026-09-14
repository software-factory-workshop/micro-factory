import type { CockpitRecord,Collection } from '../../shared/cockpit';
export function useCockpit() {
 const items=useState<Record<Collection,CockpitRecord[]>>('cockpit-items',()=>({drafts:[],feedback:[],runs:[]}));
 async function refresh(collection:Collection){const response=await $fetch<{items:CockpitRecord[]}>(`/factory/cockpit/records/${collection}`);items.value[collection]=response.items;return response.items;}
 async function save(collection:Collection,id:string,value:Record<string,unknown>,version=0){const response=await $fetch<{item:CockpitRecord}>(`/factory/cockpit/records/${collection}/${encodeURIComponent(id)}`,{method:'PUT',body:{value,expectedVersion:version},retry:0});items.value[collection]=[response.item,...items.value[collection].filter(r=>r.id!==id)];return response.item;}
 async function remove(collection:Collection,item:CockpitRecord){await $fetch(`/factory/cockpit/records/${collection}/${encodeURIComponent(item.id)}`,{method:'DELETE',body:{expectedVersion:item.version},retry:0});items.value[collection]=items.value[collection].filter(r=>r.id!==item.id);}
 // Legacy storage remains untouched. Import only missing records, never replace
 // shared edits with a browser snapshot; repeat imports are safe.
 async function migrate(collection:Collection,legacy:Array<{id:string;value:Record<string,unknown>}>){
  if(legacy.length)await $fetch('/factory/cockpit/import',{method:'POST',body:{collection,items:legacy},retry:0});
  await refresh(collection);
 }

 return {items,refresh,save,remove,migrate};
}
