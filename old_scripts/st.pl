open F,"<:utf8","c.txt"; my @ev;
while(<F>){ s/\x{feff}//g; next unless /\S/; my @p=split; push @ev,[$p[0],$p[2]+0,$p[3]+0,$p[4]+0,$p[5]+0,$p[6]+0]; }
my %g; for(@ev){ push @{$g{$_->[1]}}, $_ }
for my $t (sort {$a<=>$b} keys %g){ 
  my %lx; $lx{sprintf("%.2f",$_->[3])}=1 for @{$g{$t}};
  next unless keys %lx >=2;
  printf "[%.3f]", $t;
  for my $e (sort {$a->[3]<=>$b->[3]} @{$g{$t}}){ printf "  %s x=%.2f dir=%d",$e->[0],$e->[3],$e->[4]; }
  print "\n";
} 
